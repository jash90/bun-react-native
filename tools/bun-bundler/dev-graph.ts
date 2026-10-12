// Development module graph of the Bun bundler.
//
// Production bundles are linked by Bun.build; development bundles use the Metro module format instead
// (`__d(factory, id, dependencyIds, name)` + the Metro/Expo `require` runtime), because that runtime is what
// React Native uses on the device to hot-replace modules and drive React Refresh (Fast Refresh):
// an HMR update is the new `__d(...)` of the changed modules plus their inverse dependencies.
//
// Everything here runs on Bun: transforms in Bun Workers (Expo's Babel transform + ESM->CJS), resolution
// with ./resolver.ts, caching with Bun.hash/Bun.file, serving with Bun.serve (./dev-server.ts).
import fs from 'node:fs';
import path from 'node:path';

import { getAssetData } from './assets';
import { ASSET_REGISTRY_VIRTUAL } from './resolver';
import { ASSET_REGISTRY_SRC, contextModuleSource, createProject, listContextFiles, type ContextSpec, type Project } from './shared';
import { REQUIRE_CONTEXT_PREFIX } from './transform-worker';
import { transformCss } from './web';

const EMPTY_MODULE = '\0empty';
const ASSET_PREFIX = '\0asset:';

interface Mod {
  key: string; // absolute file path or virtual id
  id: number;
  deps: string[]; // resolved keys, in `_dependencyMap` order
  code: string; // CommonJS module body
  map: any | null; // source map of `code` (Babel), null for generated modules
  name: string; // verbose name (project-relative)
  inverse: Set<string>; // keys of modules depending on this one
  contextSpec?: ContextSpec;
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

  constructor(opts: { projectRoot: string; platform: 'ios' | 'android' | 'web'; entryFile: string }) {
    this.project = createProject({ projectRoot: opts.projectRoot, platform: opts.platform, dev: true });
    this.entryFile = opts.entryFile;
  }

  get platform() {
    return this.project.platform;
  }

  has(file: string) {
    return this.modules.has(file);
  }

  /** Build the whole graph from the run-before-main modules and the entry. */
  build(): Promise<void> {
    if (!this.building) {
      this.building = (async () => {
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
    if (key.startsWith(REQUIRE_CONTEXT_PREFIX)) {
      const spec = JSON.parse(key.slice(REQUIRE_CONTEXT_PREFIX.length));
      return `require.context(${path.relative(root, spec.dir) || '.'})`;
    }
    if (key.startsWith(ASSET_PREFIX)) return path.relative(root, key.slice(ASSET_PREFIX.length));
    if (key.startsWith('\0')) return key.slice(1);
    return path.relative(root, key);
  }

  private async ensure(key: string, parent: string | null): Promise<Mod> {
    let mod = this.modules.get(key);
    if (mod) {
      if (parent) mod.inverse.add(parent);
      return mod;
    }
    mod = {
      key,
      id: this.nextId++,
      deps: [],
      code: '',
      map: null,
      name: this.displayName(key),
      inverse: new Set(parent ? [parent] : []),
    };
    this.modules.set(key, mod);
    try {
      await this.load(mod);
    } catch (e) {
      this.modules.delete(key);
      throw e;
    }
    return mod;
  }

  /** (Re)compute code + dependencies of a module and load dependencies that are new to the graph. */
  private async load(mod: Mod): Promise<string[]> {
    const { key } = mod;
    let specs: { key: string }[] = [];
    if (key === EMPTY_MODULE) {
      mod.code = '';
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
      // Metro's template; Metro-format modules load dependencies through `_dependencyMap` (lazy modes as eager:
      // the dev graph has no async chunks)
      mod.code = contextModuleSource(spec.mode.startsWith('lazy') ? { ...spec, mode: 'eager' } : spec, files, (i) => `require(_dependencyMap[${i}])`);
    } else {
      const ext = path.extname(key).slice(1);
      if (ext === 'json') {
        mod.code = `module.exports = ${fs.readFileSync(key, 'utf8')};`;
      } else if (ext === 'css' || ext === 'scss' || ext === 'sass') {
        // web: style tag injected by the module, replaced in place on HMR (Expo's development CSS wrapper)
        mod.code = this.project.isWeb ? (await transformCss(this.project, key, { dev: true, server: false })).js : '';
      } else {
        const res = await this.project.transform(key, 'module', 'metro');
        mod.code = res.code ?? '';
        mod.map = res.map ?? null;
        const esm = new Set(res.esmDeps ?? []);
        specs = (res.deps ?? []).map((spec) => ({ key: this.resolveSpec(spec, key, esm.has(spec)) }));
      }
    }
    const previous = new Set(mod.deps);
    mod.deps = specs.map((s) => s.key);
    for (const old of previous) if (!mod.deps.includes(old)) this.modules.get(old)?.inverse.delete(key);
    const added: string[] = [];
    await Promise.all(
      mod.deps.map(async (dep) => {
        const existed = this.modules.has(dep);
        await this.ensure(dep, key);
        if (!existed) added.push(dep);
      })
    );
    return added;
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

  private wrap(mod: Mod, inverseDependencies?: Record<number, number[]>) {
    const depIds = mod.deps.map((d) => this.modules.get(d)!.id);
    const extra = inverseDependencies ? `,${JSON.stringify(inverseDependencies)}` : '';
    return `__d(function (${WRAPPER_PARAMS}) {\n${mod.code}\n},${mod.id},${JSON.stringify(depIds)},${JSON.stringify(mod.name)}${extra});`;
  }

  /** The whole development bundle (prelude, Metro require runtime, polyfills, modules, run statements) + map. */
  async serialize(bundleUrl: string, mapUrl: string): Promise<{ code: string; map: any }> {
    await this.build();
    const { project } = this;
    const runtime = fs.readFileSync(project.projectRequire.resolve('@expo/cli/build/metro-require/require.js'), 'utf8');
    const head = [project.prelude(), `(function (global) {\n${runtime}\n})(globalThis);`, ...(await project.polyfillSources())].join('\n') + '\n';
    const parts: string[] = [head];
    let line = head.split('\n').length - 1;
    const sections: any[] = [];
    const ordered = [...this.modules.values()].sort((a, b) => a.id - b.id);
    for (const mod of ordered) {
      const code = this.wrap(mod) + '\n';
      if (mod.map) sections.push({ offset: { line: line + 1, column: 0 }, map: this.relativeMap(mod.map) });
      parts.push(code);
      line += code.split('\n').length - 1;
    }
    for (const r of this.roots) parts.push(`__r(${this.modules.get(r)!.id});\n`);
    parts.push(`//# sourceMappingURL=${mapUrl}\n//# sourceURL=${bundleUrl}\n`);
    return { code: parts.join(''), map: { version: 3, sections } };
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
      if (!mod || mod.id in out) return;
      out[mod.id] = [...mod.inverse].map((p) => this.modules.get(p)?.id).filter((x): x is number => x != null);
      for (const p of mod.inverse) visit(p);
    };
    visit(key);
    return out;
  }

  /**
   * Apply file system changes; returns the HMR update (Metro protocol) or null when nothing in this graph changed.
   * `changed`: absolute paths that were modified, added or removed.
   */
  async update(changed: string[], urls: { bundleUrl: (mod: string) => string; mapUrl: (mod: string) => string }): Promise<HmrUpdate | null> {
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
    const modified: string[] = [];
    for (const key of touched) {
      const mod = this.modules.get(key)!;
      if (key.startsWith(ASSET_PREFIX)) {
        const dir = path.dirname(this.assetFiles.get(key)![0]);
        const base = path.basename(this.assetFiles.get(key)![0]);
        const r = this.project.resolver.resolve(path.join(dir, base), path.join(dir, 'index.js'), false);
        if (r.type === 'assetFiles') this.assetFiles.set(key, r.filePaths);
      }
      const before = this.wrap(mod);
      for (const a of await this.load(mod)) added.add(a);
      if (this.wrap(mod) !== before) modified.push(key);
    }
    // newly reachable modules may pull in more modules; `load` already loaded them recursively
    const entry = (key: string): HmrModule => {
      const mod = this.modules.get(key)!;
      const sourceURL = urls.bundleUrl(mod.name);
      const sourceMappingURL = urls.mapUrl(mod.name);
      const code = `${this.wrap(mod, this.inverseDependenciesOf(key))}\n//# sourceMappingURL=${sourceMappingURL}\n//# sourceURL=${sourceURL}\n`;
      return { module: [mod.id, code], sourceURL, sourceMappingURL };
    };
    if (!added.size && !modified.length) return null;
    return { added: [...added].map(entry), modified: modified.map(entry), deleted: [] };
  }

  nameOf(id: number) {
    for (const m of this.modules.values()) if (m.id === id) return m.name;
    return String(id);
  }

  close() {
    this.project.close();
  }
}
