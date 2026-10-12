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

import { assetModuleSource, getAssetData, saveAssets, type AssetData } from './assets';
import { ASSET_REGISTRY_VIRTUAL } from './resolver';
import { ASSET_REGISTRY_SRC, createProject, requireContextSource } from './shared';
import { REQUIRE_CONTEXT_PREFIX } from './transform-worker';

export { ASSET_EXTS, SOURCE_EXTS } from './shared';

export interface BundleOptions {
  projectRoot: string;
  entryFile: string;
  platform: 'ios' | 'android';
  dev: boolean;
  minify: boolean;
  bundleOutput: string;
  sourcemapOutput?: string;
  assetsDest?: string;
  routerRoot?: string;
  workers?: number;
  resetCache?: boolean;
  log?: (msg: string) => void;
}

export interface BundleResult {
  modules: string[];
  assets: AssetData[];
  timings: Record<string, number>;
}

const ENTRY_ID = '\0bun-rn:entry';

export async function bundle(opts: BundleOptions): Promise<BundleResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const log = opts.log ?? (() => {});
  const { projectRoot, platform, dev } = opts;
  const project = createProject(opts);
  const { resolver, runBeforeMain, projectPkg, projectRequire } = project;
  const entry = path.resolve(projectRoot, opts.entryFile);

  const modules = new Set<string>();
  const assets: AssetData[] = [];
  // Bun does not carry `pluginData` from onResolve to onLoad: keep per-path data here.
  const assetFilesByPath = new Map<string, string[]>();
  // Imports of names a module does not export (typically TypeScript types re-exported without
  // `export type`). Metro yields `undefined` at runtime; Bun fails linking. Stub them as undefined.
  const missingExports = new Map<string, Set<string>>();
  // Babel source maps per file: Bun maps the bundle to the Babel output only; composed at the end.
  const babelMaps = new Map<string, any>();
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
        const r = resolver.resolve(args.path, importer, isESM);
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

      build.onLoad({ filter: /.*/, namespace: 'rn-empty' }, () => ({ contents: 'module.exports = {};', loader: 'js' })); // CommonJS like Metro's empty module: named imports are undefined

      build.onLoad({ filter: /.*/, namespace: 'rn-asset' }, (args) => {
        const data = getAssetData(assetFilesByPath.get(args.path)!, projectRoot);
        assets.push(data);
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
        if (ext === 'css' || ext === 'scss' || ext === 'sass') return { contents: '', loader: 'js' }; // native: no CSS
        const { code, map } = await transformModule(file);
        const stubs = missingExports.get(file);
        const stubCode = stubs ? '\n' + [...stubs].map((n) => `export var ${n} = void 0;`).join('\n') : '';
        if (map) babelMaps.set(file, map);
        return { contents: code! + stubCode, loader: 'js' };
      });
    },
  };

  const tPoly = performance.now();
  const polyfills = await project.polyfillSources();
  for (const f of project.polyfillFiles) if (!f.startsWith('\0')) modules.add(f);
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
  const jsOut = result.outputs.find((o: any) => o.kind === 'entry-point')!;
  const mainCode = (await jsOut.text()).replace(/\n?\/\/# (sourceMappingURL|debugId)=.*$/gm, '');

  // ---- prelude + polyfills + module graph
  // Dev bundles from Bun.build have no Metro module runtime: inert React Refresh globals and `require`.
  const devPrelude = dev
    ? `var $RefreshReg$=function(){},$RefreshSig$=function(){return function(t){return t}};` +
      `var require=globalThis.require||function(id){throw new Error('Cannot require "'+id+'" at runtime in a Bun bundle')};`
    : '';
  const head = [project.prelude(devPrelude), ...polyfills].join('\n') + '\n';
  fs.mkdirSync(path.dirname(opts.bundleOutput), { recursive: true });
  fs.writeFileSync(opts.bundleOutput, head + mainCode + '\n');

  if (opts.sourcemapOutput) {
    const smOut = result.outputs.find((o: any) => o.kind === 'sourcemap');
    const bunMap = smOut ? JSON.parse(await smOut.text()) : { version: 3, sources: [], names: [], mappings: '' };
    // bundle -> Babel output (Bun) composed with Babel output -> original source (per file). Only Bun's
    // (project-relative) sources get a Babel map; Babel maps point at absolute originals, ending the chain.
    const remapping = projectRequire('@jridgewell/remapping');
    const map: any = remapping(bunMap, (source: string) => {
      if (path.isAbsolute(source)) return null;
      return babelMaps.get(path.resolve(projectRoot, source)) ?? null;
    });
    // Shift the module-graph mappings below the (unmapped) prelude and polyfills.
    map.mappings = ';'.repeat(head.split('\n').length - 1) + map.mappings;
    map.sources = map.sources.map((s: string) => (path.isAbsolute(s) ? path.relative(projectRoot, s) : s));
    fs.writeFileSync(opts.sourcemapOutput, JSON.stringify(map));
  }

  if (opts.assetsDest) log(`Copied ${saveAssets(assets, platform, opts.assetsDest)} asset files`);

  timings.total = performance.now() - t0;
  timings.cacheHits = project.stats.cacheHits;
  return { modules: [...modules], assets, timings };
}
