// Bun bundler for React Native / Expo: production bundles (replaces Metro in native release builds).
//
// Pipeline: Bun.build (module graph, ESM/CJS linking, minification, source map)
//   + Resolver (Metro-equivalent React Native resolution, ./resolver.ts)
//   + Babel worker pool (the exact Expo Babel transform, ./transform-worker.ts) with a persistent cache
//   + virtual modules (entry with run-before-main modules, asset registry, require.context, Expo polyfills)
//   + Metro-compatible prelude and polyfills, assets (./assets.ts).
// Output is a plain script (IIFE) that Hermes can compile. Development uses ./dev-graph.ts instead
// (Metro module format, so the React Native runtime can hot-replace modules).
import fs from 'node:fs';
import path from 'node:path';
import type { BunPlugin } from 'bun';

import { assetModuleSource, getAssetData, type AssetData } from './assets';
import { expoHelpers } from './expo-helpers';
import { transformCss } from './web';
import { ASSET_REGISTRY_VIRTUAL } from './resolver';
import { ASSET_REGISTRY_SRC, MISSING_MODULE_NAMESPACE, createProject, metafileOrder, missingModuleSource, requireContextSource, strictIife } from './shared';
import { PRELUDE_SOURCE, concatPieces, debugIdFor, finalizeMap, serverRootOf, type FunctionMap, type MapPiece, type RawMap } from './sourcemap';
import { REQUIRE_CONTEXT_PREFIX } from './transform-worker';

export { ASSET_EXTS, SOURCE_EXTS } from './shared';

export interface BundleOptions {
  projectRoot: string;
  entryFile: string;
  platform: 'ios' | 'android' | 'tvos' | 'macos';
  dev: boolean;
  minify: boolean;
  bundleOutput: string;
  sourcemapOutput?: string;
  assetsDest?: string;
  /** `expo export --unstable-hosted-native`: assets named `name.<md5>` and served like web assets */
  hostedAssets?: boolean;
  /** iOS: put images into an asset catalog (`--asset-catalog-dest`, like expo export:embed) */
  assetCatalogDest?: string;
  /**
   * export:embed with a source map: `//# sourceMappingURL=<url>` + `//# debugId=<id>` annotations, `debugId` in the
   * map (Expo: the map's base name, or the path with `--sourcemap-use-absolute-path`)
   */
  sourceMapUrl?: string;
  /** `--sourcemap-sources-root`: map sources relative to this directory (Metro relativizeSourceMap) */
  sourcemapSourcesRoot?: string;
  /** `--bundle-encoding` (utf8 | utf16le | ascii) */
  bundleEncoding?: BufferEncoding;
  /** `--unstable-transform-profile` (default: hermes-stable with Hermes, default with JSC) */
  transformProfile?: string;
  routerRoot?: string;
  workers?: number;
  resetCache?: boolean;
  log?: (msg: string) => void;
}

export interface BundleResult {
  modules: string[];
  /** file URLs of `"use dom"` components (their web bundles are exported by ./dom.ts) */
  domComponents: string[];
  assets: AssetData[];
  timings: Record<string, number>;
  /** the bundle without map annotations */
  code: string;
  /** Expo-shaped source map (without `debugId`), when a source map was requested */
  map: RawMap | null;
}

const ENTRY_ID = '\0bun-rn:entry';
const md5hex = (s: string) => new Bun.CryptoHasher('md5').update(s).digest('hex');

export async function bundle(opts: BundleOptions): Promise<BundleResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const log = opts.log ?? (() => {});
  const { projectRoot, platform, dev } = opts;
  const project = createProject(opts);
  const { resolver, runBeforeMain, projectPkg, projectRequire } = project;
  const entry = path.resolve(projectRoot, opts.entryFile);

  const modules = new Set<string>();
  const domComponents = new Set<string>();
  const optionalByFile = new Map<string, Set<string>>();
  const assetByPath = new Map<string, AssetData>();
  // Bun does not carry `pluginData` from onResolve to onLoad: keep per-path data here.
  const assetFilesByPath = new Map<string, string[]>();
  // Imports of names a module does not export (typically TypeScript types re-exported without
  // `export type`). Metro yields `undefined` at runtime; Bun fails linking. Stub them as undefined.
  const missingExports = new Map<string, Set<string>>();
  // Babel source maps per file: Bun maps the bundle to the Babel output only; composed at the end.
  const babelMaps = new Map<string, any>();
  // Metro function maps per file -> `x_facebook_sources`
  const functionMaps = new Map<string, FunctionMap | null>();
  // In-memory transform results, so link retries do not hit the disk cache again.
  const transformed = new Map<string, ReturnType<typeof project.transform>>();
  const transformModule = (file: string) => {
    let p = transformed.get(file);
    if (!p) transformed.set(file, (p = project.transform(file, 'module', 'esm')));
    return p;
  };

  const plugin: BunPlugin = {
    name: 'react-native',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === ENTRY_ID) return { path: ENTRY_ID, namespace: 'rn-virtual' };
        if (args.path.startsWith(REQUIRE_CONTEXT_PREFIX)) {
          // Make the context directory absolute (relative to the importing file) and part of the module path.
          const spec = JSON.parse(args.path.slice(REQUIRE_CONTEXT_PREFIX.length));
          spec.dir = path.resolve(path.dirname(args.importer), spec.dir);
          return { path: REQUIRE_CONTEXT_PREFIX + JSON.stringify(spec), namespace: 'rn-context' };
        }
        const importer = args.importer && args.namespace === 'file' ? args.importer : projectPkg;
        const isESM = args.kind === 'import-statement' || args.kind === 'dynamic-import';
        let r;
        try {
          r = resolver.resolve(args.path, importer, isESM);
        } catch (e) {
          // Metro allowOptionalDependencies: unresolved requires inside try blocks throw only when they run
          if (!optionalByFile.get(importer)?.has(args.path)) throw e;
          return { path: args.path, namespace: MISSING_MODULE_NAMESPACE };
        }
        if (r.type === 'empty') return { path: `empty:${args.path}`, namespace: 'rn-empty' };
        if (r.type === 'assetFiles') {
          assetFilesByPath.set(r.filePaths[0], r.filePaths);
          return { path: r.filePaths[0], namespace: 'rn-asset' };
        }
        if (r.filePath === ASSET_REGISTRY_VIRTUAL) return { path: ASSET_REGISTRY_VIRTUAL, namespace: 'rn-virtual' };
        return { path: r.filePath, namespace: 'file' };
      });

      build.onLoad({ filter: /.*/, namespace: 'rn-virtual' }, (args) => {
        if (args.path === ENTRY_ID) {
          return { contents: [...runBeforeMain, entry].map((f) => `import ${JSON.stringify(f)};`).join('\n'), loader: 'js' };
        }
        if (args.path === ASSET_REGISTRY_VIRTUAL) return { contents: ASSET_REGISTRY_SRC, loader: 'js' };
        throw new Error(`Unknown virtual module ${args.path}`);
      });

      build.onLoad({ filter: /.*/, namespace: MISSING_MODULE_NAMESPACE }, (args) => ({ contents: missingModuleSource(args.path), loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'rn-empty' }, () => ({ contents: 'module.exports = {};', loader: 'js' })); // CommonJS like Metro's empty module: named imports are undefined

      build.onLoad({ filter: /.*/, namespace: 'rn-asset' }, (args) => {
        let data = getAssetData(assetFilesByPath.get(args.path)!, projectRoot, '/assets', platform);
        // hosted assets carry their content hash in the name (@expo/metro-config getUniversalAssetData, isHosted)
        if (opts.hostedAssets) data = { ...data, name: `${data.name}.${data.fileHashes.length === 1 ? data.fileHashes[0] : md5hex(data.fileHashes.join(''))}` };
        assetByPath.set(args.path, data);
        for (const f of data.files) modules.add(f);
        return { contents: assetModuleSource(data, '@react-native/assets-registry/registry'), loader: 'js' };
      });

      build.onLoad({ filter: /.*/, namespace: 'rn-context' }, (args) => {
        const spec = JSON.parse(args.path.slice(REQUIRE_CONTEXT_PREFIX.length));
        return { contents: requireContextSource(projectRoot, spec), loader: 'js', resolveDir: spec.dir };
      });

      build.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
        const file = args.path;
        modules.add(file);
        const ext = path.extname(file).slice(1);
        if (ext === 'json') return { contents: fs.readFileSync(file, 'utf8'), loader: 'json' };
        if (ext === 'css' || ext === 'scss' || ext === 'sass') return { contents: (await transformCss(project, file)).js, loader: 'js' }; // native: Expo's empty CSS module
        const { code, map, domComponentReference, optionalDeps, functionMap } = await transformModule(file);
        functionMaps.set(file, functionMap ?? null);
        if (optionalDeps?.length) optionalByFile.set(file, new Set(optionalDeps));
        if (domComponentReference) domComponents.add(domComponentReference);
        const stubs = missingExports.get(file);
        const stubCode = stubs ? '\n' + [...stubs].map((n) => `export var ${n} = void 0;`).join('\n') : '';
        if (map) babelMaps.set(file, map);
        return { contents: code! + stubCode, loader: 'js' };
      });
    },
  };

  const tPoly = performance.now();
  const polyfills = await project.polyfillPieces();
  for (const p of polyfills) {
    if (!p.file.startsWith('\0')) modules.add(p.file);
    if (p.functionMap) functionMaps.set(p.file, p.functionMap);
  }
  timings.polyfills = performance.now() - tPoly;

  // ---- module graph (retried while Bun reports imports of names a module does not export)
  const tBuild = performance.now();
  let result: any;
  try {
    for (let attempt = 0; ; attempt++) {
      result = await Bun.build({
        entrypoints: [ENTRY_ID],
        plugins: [plugin],
        target: 'browser',
        format: 'iife',
        minify: opts.minify,
        sourcemap: opts.sourcemapOutput ? 'external' : 'none',
        metafile: true,
        define: {
          __DEV__: String(dev),
          'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
          global: 'globalThis',
        },
        throw: false,
      } as any);
      if (result.success || attempt >= 5) break;
      let added = 0;
      for (const l of result.logs) {
        const m = String(l).match(/No matching export in "(.+?)" for import "(.+?)"/);
        if (!m) continue;
        const file = path.resolve(projectRoot, m[1]);
        if (!missingExports.has(file)) missingExports.set(file, new Set());
        if (!missingExports.get(file)!.has(m[2])) {
          missingExports.get(file)!.add(m[2]);
          added++;
        }
      }
      if (!added) break;
      log(`Stubbing ${added} missing export(s) as undefined (Metro semantics), relinking`);
    }
  } finally {
    project.close();
  }
  timings.build = performance.now() - tBuild;
  if (!result.success) throw new Error(`Bun.build failed:\n${result.logs.map((l: any) => String(l)).join('\n')}`);
  // assets in Metro's graph order (depth-first from the entry, imports in source order), deterministic
  const assets = metafileOrder(result.metafile, ENTRY_ID).pre.filter((p) => assetByPath.has(p)).map((p) => assetByPath.get(p)!);
  const jsOut = result.outputs.find((o: any) => o.kind === 'entry-point')!;
  const smOut = opts.sourcemapOutput ? result.outputs.find((o: any) => o.kind === 'sourcemap') : null;
  // ES modules run in strict mode, like in Metro (Bun hoists them into one non-strict function)
  const strict = strictIife(
    (await jsOut.text()).replace(/\n?\/\/# (sourceMappingURL|debugId)=.*$/gm, ''),
    smOut ? JSON.parse(await smOut.text()) : null,
    projectRequire
  );
  const mainCode = strict.code;

  // ---- prelude + polyfills + module graph
  // Dev bundles from Bun.build have no Metro module runtime: inert React Refresh globals and `require`.
  const devPrelude = dev
    ? `var $RefreshReg$=function(){},$RefreshSig$=function(){return function(t){return t}};` +
      `var require=globalThis.require||function(id){throw new Error('Cannot require "'+id+'" at runtime in a Bun bundle')};`
    : '';
  let graphMap: RawMap | null = null;
  if (opts.sourcemapOutput) {
    // bundle -> Babel output (Bun) composed with Babel output -> original source (per file). Only Bun's
    // (project-relative) sources get a Babel map; Babel maps point at absolute originals, ending the chain.
    const remapping = projectRequire('@jridgewell/remapping');
    graphMap = remapping(strict.map ?? { version: 3, sources: [], names: [], mappings: '' }, (source: string) => {
      if (path.isAbsolute(source)) return null;
      return babelMaps.get(path.resolve(projectRoot, source)) ?? null;
    });
  }
  const pieces: MapPiece[] = [{ code: project.prelude(devPrelude), source: PRELUDE_SOURCE }, ...polyfills, { code: mainCode, map: graphMap }];
  const joined = concatPieces(pieces, projectRequire);
  const code = joined.code + '\n';
  let map: RawMap | null = null;
  let annotations = '';
  if (opts.sourcemapOutput) {
    map = finalizeMap(joined.map, { projectRoot, serverRoot: serverRootOf(projectRoot, projectRequire), projectRequire, functionMaps });
    let written: RawMap = map;
    if (opts.sourceMapUrl) {
      // Expo export:embed: the debug id of the content-hashed name `<entry>-<md5>` (like `expo export`)
      const debugId = debugIdFor(`${path.basename(entry).replace(/\.\w+$/, '')}-${md5hex(code)}`, projectRequire);
      written = { ...map, debugId };
      annotations = `//# sourceMappingURL=${opts.sourceMapUrl}\n//# debugId=${debugId}`;
    }
    if (opts.sourcemapSourcesRoot != null) {
      written = { ...written, sources: [...written.sources] };
      projectRequire('metro/private/lib/relativizeSourceMap').default(written, opts.sourcemapSourcesRoot);
    }
    fs.mkdirSync(path.dirname(opts.sourcemapOutput), { recursive: true });
    fs.writeFileSync(opts.sourcemapOutput, JSON.stringify(written));
  }
  fs.mkdirSync(path.dirname(opts.bundleOutput), { recursive: true });
  fs.writeFileSync(opts.bundleOutput, code + annotations, opts.bundleEncoding ?? 'utf8');

  if (opts.assetsDest) {
    // Expo CLI's own asset persistence (expo export:embed): iOS scale filtering / asset catalog, Android
    // drawable-*dpi + raw/keep.xml
    await expoHelpers(projectRoot).persistMetroAssetsAsync(projectRoot, assets, {
      platform,
      outputDirectory: opts.assetsDest,
      iosAssetCatalogDirectory: opts.assetCatalogDest,
    });
  }

  timings.total = performance.now() - t0;
  timings.cacheHits = project.stats.cacheHits;
  return { modules: [...modules], assets, timings, domComponents: [...domComponents], code, map };
}
