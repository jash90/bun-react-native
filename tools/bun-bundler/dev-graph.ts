// Development module graph of the Bun bundler: Metro module format (`__d(factory, id, dependencyIds, name)` + the
// Expo `require` runtime), which React Native uses on the device for HMR and Fast Refresh. Resolution with
// ./resolver.ts, serving with Bun.serve (./dev-server.ts). Native platforms: modules transformed by Metro's own
// Transformer (./metro-transformer.ts) and serialized like metro/Server (./dev-graph-metro.ts), so bundles, maps and
// HMR updates are Metro's byte for byte. Web and BUN_DEV_TRANSFORM=bun: the Bun bundler's transform (Expo's Babel
// transform + ESM->CJS in Bun Workers, Bun.hash/Bun.file cache) and the serialization below.
import fs from 'node:fs';
import path from 'node:path';

import { getAssetData } from './assets';
import { ASSET_REGISTRY_VIRTUAL } from './resolver';
import { ASSET_REGISTRY_SRC, contextModuleSource, missingModuleSource, createProject, listContextFiles, type ContextSpec, type Platform, type Project } from './shared';
import type { FunctionMap } from './sourcemap';
import { createMetroSerializer, loadMetroModule, metroGraphModules, type MetroModuleData, type MetroSerializer } from './dev-graph-metro';
import { createMetroTransformer, type MetroDependency, type MetroTransformer } from './metro-transformer';
import { REQUIRE_CONTEXT_PREFIX } from './transform-worker';
import { transformCss } from './web';

const EMPTY_MODULE = '\0empty';
const MISSING_PREFIX = '\0missing:';
const ASSET_PREFIX = '\0asset:';

interface Mod {
  key: string; // absolute file path or virtual id
  id: number;
  deps: string[]; // resolved keys, in `_dependencyMap` order
  async: boolean[]; // per dependency: loaded with `import()` (lazy bundle, Metro asyncType 'async')
  loaded: boolean; // false: only known as an async dependency (id assigned, not transformed yet)
  code: string; // CommonJS module body
  map: any | null; // source map of `code` (Babel), null for generated modules
  functionMap?: FunctionMap | null; // Metro function map (`x_facebook_sources` of the served map)
  name: string; // verbose name (project-relative)
  inverse: Set<string>; // keys of modules depending on this one
  contextSpec?: ContextSpec;
  /** Metro's transform output: `__d(function (...) {...});` without parameters, raw mappings, Metro dependencies */
  metro?: { code: string; map: any[]; type: string; lineCount: number; deps: MetroDependency[]; getSource: () => Buffer } | null;
}

export interface HmrModule {
  module: [number, string];
  sourceURL: string;
  sourceMappingURL: string;
}

export interface HmrUpdate {
  added: HmrModule[];
  modified: HmrModule[];
  deleted: number[];
}

const WRAPPER_PARAMS = 'global, require, _$$_IMPORT_DEFAULT, _$$_IMPORT_ALL, module, exports, _dependencyMap';

export class DevGraph {
  readonly project: Project;
  private modules = new Map<string, Mod>();
  private nextId = 0;
  private roots: string[] = [];
  private entryFile: string;
  private building: Promise<void> | null = null;
  private assetFiles = new Map<string, string[]>();
  /** URL of the last served bundle: the base of lazy bundle URLs (Metro `sourceUrl`) */
  private bundleUrl: string | null = null;
  /** keys loaded while applying an update (all of them go to the client as `added`) */
  private newlyLoaded: Set<string> | null = null;
  /** build progress like metro/DeltaBundler/Graph (onDependencyAdd / onDependencyAdded), for the reporter */
  onProgress: ((transformedFileCount: number, totalFileCount: number) => void) | null = null;
  private progress = { done: 0, total: 0 };
  /** Metro's Transformer and serializer (native platforms) */
  private metro: Promise<MetroTransformer> | null = null;
  private metroSerializer: MetroSerializer | null = null;
  private emptyModulePath: string | null = null;

  constructor(opts: { projectRoot: string; platform: Platform; entryFile: string; dom?: string; dev?: boolean; minify?: boolean }) {
    this.project = createProject({ projectRoot: opts.projectRoot, platform: opts.platform, dev: opts.dev ?? true, minify: opts.minify ?? false, dom: opts.dom });
    this.entryFile = opts.entryFile;
    if (!this.project.isWeb && process.env.BUN_DEV_TRANSFORM !== 'bun') {
      this.metro = createMetroTransformer({
        projectRoot: this.project.projectRoot,
        platform: this.project.platform,
        dev: this.project.dev,
        minify: this.project.minify,
        entryFile: opts.entryFile,
        customTransformOptions: this.project.customTransformOptions,
        transformProfile: this.project.transformProfile,
      });
    }
  }

  get platform() {
    return this.project.platform;
  }

  /** absolute path of the entry module */
  get entryPath() {
    return path.resolve(this.project.projectRoot, this.entryFile);
  }

  /** progress listener of the next build (counts restart) */
  setProgress(onProgress: DevGraph['onProgress']) {
    this.progress = { done: 0, total: 0 };
    this.onProgress = onProgress;
  }

  has(file: string) {
    return this.modules.has(file);
  }

  /** the initial build ran (later bundle requests are incremental) */
  get built() {
    return this.building != null && this.modules.size > 0;
  }

  /** Build the whole graph from the run-before-main modules and the entry. */
  build(): Promise<void> {
    if (!this.building) {
      this.building = (async () => {
        if (this.metro && !this.metroSerializer) {
          const t = await this.metro;
          t.setVirtualModule(ASSET_REGISTRY_VIRTUAL, ASSET_REGISTRY_SRC);
          this.emptyModulePath = t.config.resolver.emptyModulePath;
          this.metroSerializer = createMetroSerializer({ projectRoot: this.project.projectRoot, platform: this.project.platform, transformer: t });
        }
        this.roots = [...this.project.runBeforeMain, path.resolve(this.project.projectRoot, this.entryFile)];
        await Promise.all(this.roots.map((r) => this.ensure(r, null)));
      })();
      this.building.catch(() => (this.building = null));
    }
    return this.building;
  }

  // ---------------------------------------------------------------- loading

  private displayName(key: string) {
    const root = this.project.projectRoot;
    if (this.metro && this.isMetroModule(key)) return path.relative(root, this.metroPath(key)).split(path.sep).join('/');
    if (key.startsWith(REQUIRE_CONTEXT_PREFIX)) {
      const spec = JSON.parse(key.slice(REQUIRE_CONTEXT_PREFIX.length));
      return `require.context(${path.relative(root, spec.dir) || '.'})`;
    }
    if (key.startsWith(ASSET_PREFIX)) return path.relative(root, key.slice(ASSET_PREFIX.length));
    if (key.startsWith('\0')) return key.slice(1);
    return path.relative(root, key);
  }

  /** Add a module (and its synchronous dependencies); `lazy`: only reserve its id (async dependency). */
  private async ensure(key: string, parent: string | null, lazy = false): Promise<Mod> {
    let mod = this.modules.get(key);
    if (!mod) {
      mod = { key, id: this.metro ? -1 : this.nextId++, deps: [], async: [], loaded: false, code: '', map: null, name: this.displayName(key), inverse: new Set() };
      this.modules.set(key, mod);
    }
    if (parent) mod.inverse.add(parent);
    if (lazy || mod.loaded) return mod;
    mod.loaded = true;
    this.onProgress?.(this.progress.done, ++this.progress.total);
    try {
      await this.load(mod);
      this.onProgress?.(++this.progress.done, this.progress.total);
      this.newlyLoaded?.add(key);
    } catch (e) {
      mod.loaded = false;
      if (!mod.inverse.size) this.modules.delete(key);
      throw e;
    }
    return mod;
  }

  /** (Re)compute code + dependencies of a module and load dependencies that are new to the graph. */
  private async load(mod: Mod): Promise<void> {
    const { key } = mod;
    let specs: { key: string; async?: boolean }[] = [];
    if (this.metro && this.isMetroModule(key)) {
      specs = await this.loadMetro(mod);
    } else if (key === EMPTY_MODULE) {
      mod.code = '';
    } else if (key.startsWith(MISSING_PREFIX)) {
      mod.code = missingModuleSource(key.slice(MISSING_PREFIX.length));
    } else if (key === ASSET_REGISTRY_VIRTUAL) {
      mod.code = ASSET_REGISTRY_SRC;
    } else if (key.startsWith(ASSET_PREFIX)) {
      const data = getAssetData(this.assetFiles.get(key)!, this.project.projectRoot, '/assets', this.project.platform);
      const { files, fileSystemLocation, ...publicData } = data;
      if (this.project.isWeb) {
        // like @expo/metro-config's asset transformer for web: a URL served by the dev server (/assets/...)
        const uri = JSON.stringify(`${data.httpServerLocation}/${data.name}.${data.type}`);
        mod.code =
          data.width != null || data.height != null
            ? `module.exports = { uri: ${uri}, width: ${data.width}, height: ${data.height}, toString() { return this.uri } };`
            : `module.exports = ${uri};`;
      } else {
        mod.code = `module.exports = require(_dependencyMap[0], "@react-native/assets-registry/registry").registerAsset(${JSON.stringify(publicData)});`;
        specs = [{ key: ASSET_REGISTRY_VIRTUAL }];
      }
    } else if (key.startsWith(REQUIRE_CONTEXT_PREFIX)) {
      const spec: ContextSpec = JSON.parse(key.slice(REQUIRE_CONTEXT_PREFIX.length));
      mod.contextSpec = spec;
      const files = listContextFiles(spec.dir, spec.recursive, new RegExp(spec.filter.pattern, spec.filter.flags));
      specs = files.map((rel) => ({ key: this.resolveOrThrow(path.join(spec.dir, rel), key, false) }));
      // Metro's template; lazy modes load each file as a lazy bundle through Expo's async require
      const lazy = spec.mode.startsWith('lazy');
      const asyncReq = 'require(_dependencyMap[' + files.length + '], "expo/internal/async-require-module")';
      mod.code = contextModuleSource(spec, files, (i) => (lazy ? `${asyncReq}(_dependencyMap[${i}], _dependencyMap.paths, ${JSON.stringify(files[i])})` : `require(_dependencyMap[${i}])`));
      if (lazy) {
        specs = specs.map((sp) => ({ ...sp, async: true }));
        specs.push({ key: this.resolveOrThrow('expo/internal/async-require-module', this.project.projectPkg, false) });
      }
    } else {
      const ext = path.extname(key).slice(1);
      if (ext === 'json') {
        mod.code = `module.exports = ${fs.readFileSync(key, 'utf8')};`;
      } else if (ext === 'css' || ext === 'scss' || ext === 'sass') {
        // Expo's CSS transform: web injects `<style>` (replaced in place on HMR), native gets an empty module;
        // `@import`ed stylesheets are dependencies
        const r = await transformCss(this.project, key);
        mod.code = r.imports.map((spec, i) => `require(_dependencyMap[${i}], ${JSON.stringify(spec)});\n`).join('') + r.js;
        specs = r.imports.map((spec) => ({ key: this.resolveSpec(spec, key, false) }));
      } else {
        const res = await this.project.transform(key, 'module', 'metro');
        mod.code = res.code ?? '';
        mod.map = res.map ?? null;
        mod.functionMap = res.functionMap ?? null;
        const esm = new Set(res.esmDeps ?? []);
        const asyncIdx = new Set(res.asyncDeps ?? []);
        const optional = new Set(res.optionalDeps ?? []);
        specs = (res.deps ?? []).map((spec, i) => {
          let dep: string;
          try {
            dep = this.resolveSpec(spec, key, esm.has(spec));
          } catch (e) {
            // Metro allowOptionalDependencies: an unresolved require inside try throws only when it runs
            if (!optional.has(spec)) throw e;
            dep = MISSING_PREFIX + spec;
          }
          // only real files become lazy bundles; virtual modules are always part of the requesting bundle
          return { key: dep, async: asyncIdx.has(i) && !dep.startsWith('\0') };
        });
      }
    }
    const previous = new Set(mod.deps);
    mod.deps = specs.map((s) => s.key);
    mod.async = specs.map((s) => !!s.async);
    for (const old of previous) if (!mod.deps.includes(old)) this.modules.get(old)?.inverse.delete(key);
    await Promise.all(mod.deps.map((dep, i) => this.ensure(dep, key, mod.async[i])));
  }

  /** modules Metro transforms: files, assets and require.context modules */
  private isMetroModule(key: string) {
    return !key.startsWith('\0') || key.startsWith(ASSET_PREFIX) || key.startsWith(REQUIRE_CONTEXT_PREFIX) || key === EMPTY_MODULE || key === ASSET_REGISTRY_VIRTUAL;
  }

  /** module id: Metro's server-wide factory (by Metro path) on native, assigned when the module is added otherwise */
  private idOf(mod: Mod): number {
    if (mod.id < 0) mod.id = this.metroSerializer!.createModuleId(this.metroPath(mod.key));
    return mod.id;
  }

  /** Metro's module path: the file, the asset file, `<dir>?ctx=<hash>` for require.context */
  private metroPath(key: string) {
    if (key === EMPTY_MODULE) return this.emptyModulePath!;
    if (key.startsWith(ASSET_PREFIX)) return key.slice(ASSET_PREFIX.length);
    if (key.startsWith(REQUIRE_CONTEXT_PREFIX)) {
      const spec: ContextSpec = JSON.parse(key.slice(REQUIRE_CONTEXT_PREFIX.length));
      const { deriveAbsolutePathFromContext } = this.project.projectRequire('metro/private/lib/contextModule');
      return deriveAbsolutePathFromContext(spec.dir, { mode: spec.mode, recursive: spec.recursive, filter: spec.filter });
    }
    return key;
  }

  /** Transform with Metro (./dev-graph-metro.ts loadMetroModule) */
  private async loadMetro(mod: Mod): Promise<{ key: string; async?: boolean }[]> {
    const r = await loadMetroModule(await this.metro!, mod.key, this.metroPath(mod.key), {
      resolve: (spec, origin, isESM) => this.resolveOrThrow(spec, origin, isESM),
      contextKey: (spec) => REQUIRE_CONTEXT_PREFIX + JSON.stringify(spec),
      missingKey: (spec) => MISSING_PREFIX + spec,
      contextSpec: (key) => (key.startsWith(REQUIRE_CONTEXT_PREFIX) ? JSON.parse(key.slice(REQUIRE_CONTEXT_PREFIX.length)) : null),
      isAsset: (key) => key.startsWith(ASSET_PREFIX),
    });
    Object.assign(mod, { metro: r.metro, functionMap: r.functionMap, code: '', map: null, ...(r.contextSpec ? { contextSpec: r.contextSpec } : {}) });
    return r.specs;
  }

  private resolveSpec(spec: string, from: string, isESM: boolean): string {
    if (spec.startsWith(REQUIRE_CONTEXT_PREFIX)) {
      const s = JSON.parse(spec.slice(REQUIRE_CONTEXT_PREFIX.length));
      s.dir = path.resolve(path.dirname(from), s.dir);
      return REQUIRE_CONTEXT_PREFIX + JSON.stringify(s);
    }
    return this.resolveOrThrow(spec, from, isESM);
  }

  private resolveOrThrow(spec: string, from: string, isESM: boolean): string {
    const r = this.project.resolver.resolve(spec, from, isESM);
    if (r.type === 'empty') return EMPTY_MODULE;
    if (r.type === 'assetFiles') {
      const key = ASSET_PREFIX + r.filePaths[0];
      this.assetFiles.set(key, r.filePaths);
      return key;
    }
    return r.filePath;
  }

  // ---------------------------------------------------------------- serialization

  /**
   * metro getModuleParams: the dependency map is an array of ids, or `{...ids, paths}` when the module has async
   * dependencies, `paths[id]` = the lazy bundle URL (`/<path without extension>.bundle?<main bundle query>
   * &modulesOnly=true&runModule=false`) that Expo's async require loads.
   */
  private wrap(mod: Mod, inverseDependencies?: Record<number, number[]>) {
    const depIds = mod.deps.map((d) => this.idOf(this.modules.get(d)!));
    let depMap = JSON.stringify(depIds);
    if (mod.async.some(Boolean)) {
      const query = new URL(this.bundleUrl ?? `http://localhost/index.bundle?platform=${this.platform}&dev=true`).searchParams;
      query.set('modulesOnly', 'true');
      query.set('runModule', 'false');
      const paths: Record<number, string> = {};
      mod.deps.forEach((d, i) => {
        if (!mod.async[i]) return;
        const rel = path.relative(this.project.projectRoot, d);
        paths[depIds[i]] = '/' + path.join(path.dirname(rel), path.basename(rel, path.extname(rel))).split(path.sep).join('/') + '.bundle?' + query.toString();
      });
      depMap = JSON.stringify({ ...depIds, paths });
    }
    if (mod.metro) {
      // metro/DeltaBundler/Serializers/helpers/js.js wrapModule + getModuleParams
      const { addParamsToDefineCall } = this.project.projectRequire('metro-transform-plugins');
      const params: unknown[] = [this.idOf(mod), JSON.parse(depMap), mod.name];
      if (inverseDependencies) params.push(inverseDependencies);
      return addParamsToDefineCall(mod.metro.code, ...params);
    }
    const extra = inverseDependencies ? `,${JSON.stringify(inverseDependencies)}` : '';
    return `__d(function (${WRAPPER_PARAMS}) {\n${mod.code}\n},${mod.id},${depMap},${JSON.stringify(mod.name)}${extra});`;
  }

  /** Loaded modules reachable from `starts` through synchronous dependencies, in id order. */
  private syncClosure(starts: string[]): Mod[] {
    const seen = new Set<string>();
    const visit = (key: string) => {
      const mod = this.modules.get(key);
      if (!mod || !mod.loaded || seen.has(key)) return;
      seen.add(key);
      mod.deps.forEach((d, i) => !mod.async[i] && visit(d));
    };
    starts.forEach(visit);
    return [...seen].map((k) => this.modules.get(k)!).sort((a, b) => a.id - b.id);
  }

  private modulesWithMap(mods: Mod[], head: string) {
    const parts: string[] = [head];
    let line = head.split('\n').length - 1;
    const sections: any[] = [];
    for (const mod of mods) {
      const code = this.wrap(mod) + '\n';
      if (mod.map) sections.push({ offset: { line: line + 1, column: 0 }, map: this.relativeMap(mod.map) });
      parts.push(code);
      line += code.split('\n').length - 1;
    }
    return { parts, sections };
  }

  /** The whole development bundle (prelude, Metro require runtime, polyfills, modules, run statements) + map. */
  async serialize(bundleUrl: string, mapUrl: string): Promise<{ code: string; map: any; metro?: boolean }> {
    await this.build();
    const { project } = this;
    this.bundleUrl = bundleUrl;
    if (this.metroSerializer) {
      const entry = path.resolve(project.projectRoot, this.entryFile);
      return { ...(await this.metroSerializer.serialize(bundleUrl, entry, this.metroModules(entry), entry)), metro: true };
    }
    const runtime = fs.readFileSync(project.projectRequire.resolve('@expo/cli/build/metro-require/require.js'), 'utf8');
    const head = [project.prelude(), `(function (global) {\n${runtime}\n})(globalThis);`, ...(await project.polyfillSources())].join('\n') + '\n';
    // modules behind `import()` are not part of the main bundle (Metro `lazy=true`)
    const { parts, sections } = this.modulesWithMap(this.syncClosure(this.roots), head);
    for (const r of this.roots) parts.push(`__r(${this.modules.get(r)!.id});\n`);
    parts.push(`//# sourceMappingURL=${mapUrl}\n//# sourceURL=${bundleUrl}\n`);
    return { code: parts.join(''), map: { version: 3, sections } };
  }

  /**
   * Lazy bundle (`<file>.bundle?modulesOnly=true&runModule=false`): `__d` definitions of the module and its
   * synchronous dependencies, nothing to run. Modules the client already has are ignored by its `__d`.
   */
  async serializeLazy(file: string, bundleUrl: string, mapUrl: string): Promise<{ code: string; map: any; metro?: boolean }> {
    await this.build();
    await this.ensure(file, null);
    if (this.metroSerializer) return { ...(await this.metroSerializer.serialize(bundleUrl, file, this.metroModules(file), file)), metro: true };
    const { parts, sections } = this.modulesWithMap(this.syncClosure([file]), '');
    parts.push(`//# sourceMappingURL=${mapUrl}\n//# sourceURL=${bundleUrl}\n`);
    return { code: parts.join(''), map: { version: 3, sections } };
  }

  /** the graph Metro would build from `entry`, in Metro's order (./dev-graph-metro.ts metroGraphModules) */
  private metroModules(entry: string): MetroModuleData[] {
    const inGraph = new Set(this.syncClosure([entry]).map((m) => m.key).filter((k) => this.isMetroModule(k)));
    return metroGraphModules(entry, inGraph, (key) => this.modules.get(key)!, (key) => this.metroPath(key), (key) => key.startsWith(MISSING_PREFIX));
  }

  /** whether the file is a module of this graph (Metro: depGraph.doesFileExist, used for code frames) */
  hasModule(file: string): boolean {
    return this.modules.has(file);
  }

  /** function map of a module file (absolute path) */
  functionMapOf(file: string): FunctionMap | null {
    return this.modules.get(file)?.functionMap ?? null;
  }

  private relativeMap(map: any) {
    return {
      ...map,
      sources: (map.sources ?? []).map((s: string) => (path.isAbsolute(s) ? path.relative(this.project.projectRoot, s) : s)),
    };
  }

  // ---------------------------------------------------------------- hot updates

  /** Transitive inverse dependencies by module id (what Metro passes as the 5th `__d` argument). */
  private inverseDependenciesOf(key: string): Record<number, number[]> {
    const out: Record<number, number[]> = {};
    const visit = (k: string) => {
      const mod = this.modules.get(k);
      if (!mod || this.idOf(mod) in out) return;
      out[this.idOf(mod)] = [...mod.inverse].map((p) => this.modules.get(p)).filter((m): m is Mod => m != null).map((m) => this.idOf(m));
      for (const p of mod.inverse) visit(p);
    };
    visit(key);
    return out;
  }

  /**
   * Apply file system changes; returns the HMR update (Metro protocol) or null when nothing in this graph changed.
   * `changed`: absolute paths that were modified, added or removed.
   */
  /** whether bundles, HMR and module ids are Metro's (native platforms) */
  get isMetro() {
    return this.metro != null;
  }

  async update(changed: string[], urls: { bundleUrl: (mod: string) => string; mapUrl: (mod: string) => string; clientUrl?: string }): Promise<HmrUpdate | null> {
    await this.build();
    const touched = new Set<string>();
    for (const file of changed) {
      if (this.modules.has(file) && fs.existsSync(file)) touched.add(file);
      for (const [key, files] of this.assetFiles) if (files.includes(file) || path.dirname(files[0]) === path.dirname(file)) {
        if (this.modules.has(key)) touched.add(key);
      }
      // a route/file added or removed under a require.context directory changes the context module
      for (const mod of this.modules.values()) {
        if (mod.contextSpec && file.startsWith(mod.contextSpec.dir + path.sep)) touched.add(mod.key);
      }
    }
    if (!touched.size) return null;

    const added = new Set<string>();
    this.newlyLoaded = added;
    const modified: string[] = [];
    try {
    for (const key of touched) {
      const mod = this.modules.get(key)!;
      if (key.startsWith(ASSET_PREFIX)) {
        const dir = path.dirname(this.assetFiles.get(key)![0]);
        const base = path.basename(this.assetFiles.get(key)![0]);
        const r = this.project.resolver.resolve(path.join(dir, base), path.join(dir, 'index.js'), false);
        if (r.type === 'assetFiles') this.assetFiles.set(key, r.filePaths);
      }
      if (!mod.loaded) continue; // a lazy module the client has not loaded yet: fetched fresh when imported
      const before = this.wrap(mod);
      await this.load(mod);
      if (this.wrap(mod) !== before) modified.push(key);
    }
    } finally {
      this.newlyLoaded = null;
    }
    for (const key of touched) added.delete(key);
    if (this.metroSerializer && urls.clientUrl) {
      // Metro sends an update for every change of a graph file, also when no module output changed
      const entry = path.resolve(this.project.projectRoot, this.entryFile);
      const modules = this.metroModules(entry);
      const byPath = new Map(modules.map((m) => [m.path, m]));
      const pick = (keys: Iterable<string>) => [...keys].map((k) => byPath.get(this.metroPath(k))).filter((m): m is MetroModuleData => m != null);
      return this.metroSerializer.hmr({ added: pick(added), modified: pick(modified), deleted: [] }, modules, urls.clientUrl);
    }
    // every module loaded while applying the change (transitively) is sent as `added`
    const entry = (key: string): HmrModule => {
      const mod = this.modules.get(key)!;
      const sourceURL = urls.bundleUrl(mod.name);
      const sourceMappingURL = urls.mapUrl(mod.name);
      const code = `${this.wrap(mod, this.inverseDependenciesOf(key))}\n//# sourceMappingURL=${sourceMappingURL}\n//# sourceURL=${sourceURL}\n`;
      return { module: [this.idOf(mod), code], sourceURL, sourceMappingURL };
    };
    if (!added.size && !modified.length) return null;
    return { added: [...added].map(entry), modified: modified.map(entry), deleted: [] };
  }

  close() {
    this.project.close();
  }
}
