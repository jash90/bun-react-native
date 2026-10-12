// Bun bundler for React Native / Expo: replaces Metro for production bundles.
//
// Pipeline: Bun.build (module graph, ESM/CJS linking, tree of imports, minification, source map)
//   + Resolver (Metro-equivalent React Native resolution, ./resolver.ts)
//   + Babel worker pool (the exact Expo Babel transform, ./transform-worker.ts)
//   + virtual modules (entry with run-before-main modules, asset registry, require.context, Expo polyfills)
//   + Metro-compatible prelude and polyfills, assets (./assets.ts).
// Output is a plain script (IIFE) that Hermes can compile.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { BunPlugin } from 'bun';

import { assetModuleSource, getAssetData, saveAssets, type AssetData } from './assets';
import { ASSET_REGISTRY_VIRTUAL, Resolver } from './resolver';
import { REQUIRE_CONTEXT_PREFIX, type TransformRequest, type TransformResponse } from './transform-worker';

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

export const SOURCE_EXTS = ['ts', 'tsx', 'mjs', 'js', 'jsx', 'json', 'cjs', 'scss', 'sass', 'css'];
export const ASSET_EXTS = ['bmp', 'gif', 'jpg', 'jpeg', 'png', 'psd', 'svg', 'webp', 'xml', 'm4v', 'mov', 'mp4', 'mpeg', 'mpg', 'webm', 'aac', 'aiff', 'caf', 'm4a', 'mp3', 'wav', 'html', 'pdf', 'yaml', 'yml', 'otf', 'ttf', 'zip', 'heic', 'avif', 'db'];

const debugCount = { n: 0 };
const BUNDLER_CACHE_VERSION = 1; // bump when the transform pipeline changes
const ENTRY_ID = '\0bun-rn:entry';
const EXTERNAL_REQUIRE_POLYFILL = '\0polyfill:external-require';
const ENV_VARS_POLYFILL = '\0polyfill:environment-variables';
const ASSET_REGISTRY_SRC = `const assets=[];module.exports={registerAsset:s=>assets.push(s),getAssetByID:s=>assets[s-1]};`;
const SCRIPT_WRAPPER_GLOBAL = `typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : this`;

// ---------------------------------------------------------------- Babel worker pool

class TransformPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { req: Omit<TransformRequest, 'id'>; resolve: (r: TransformResponse) => void }[] = [];
  private pending = new Map<number, (r: TransformResponse) => void>();
  private owner = new Map<number, Worker>();
  private nextId = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./transform-worker.ts', import.meta.url).href);
      w.onerror = (e: ErrorEvent) => {
        // A crashed worker must not leave Bun.build waiting forever: fail every job it owned.
        for (const [id, done] of this.pending) {
          if (this.owner.get(id) === w) {
            this.pending.delete(id);
            done({ id, error: `transform worker crashed: ${e.message}` });
          }
        }
      };
      w.onmessage = (e: MessageEvent<TransformResponse>) => {
        this.owner.delete(e.data.id);
        const done = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        this.idle.push(w);
        done?.(e.data);
        this.pump();
      };
      w.addEventListener('close', (e: any) => {
        if (process.env.BUN_BUNDLER_DEBUG) console.error(`[bun-bundler] worker closed (code ${e?.code})`);
        // a worker that exits must not keep jobs pending forever
        for (const [id, done] of this.pending) {
          if (this.owner.get(id) === w) {
            this.pending.delete(id);
            done({ id, error: 'transform worker exited unexpectedly' });
          }
        }
        this.idle = this.idle.filter((x) => x !== w);
      });
      this.workers.push(w);
      this.idle.push(w);
    }
    if (process.env.BUN_BUNDLER_DEBUG) {
      this.debugTimer = setInterval(() => {
        console.error(`[bun-bundler] pool: queue=${this.queue.length} pending=${this.pending.size} idle=${this.idle.length}/${this.workers.length}`);
      }, 3000);
    }
  }

  private debugTimer: ReturnType<typeof setInterval> | null = null;

  run(req: Omit<TransformRequest, 'id'>): Promise<TransformResponse> {
    return new Promise((resolve) => {
      this.queue.push({ req, resolve });
      this.pump();
    });
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, job.resolve);
      this.owner.set(id, w);
      w.postMessage({ ...job.req, id });
    }
  }

  close() {
    if (this.debugTimer) clearInterval(this.debugTimer);
    for (const w of this.workers) w.terminate();
  }
}

// ---------------------------------------------------------------- helpers

function readTsconfigPaths(projectRoot: string) {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'tsconfig.json'), 'utf8');
    const tsconfig = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
    const paths = tsconfig.compilerOptions?.paths;
    if (!paths) return null;
    return { baseUrl: path.resolve(projectRoot, tsconfig.compilerOptions.baseUrl ?? '.'), paths };
  } catch {
    return null;
  }
}

function listContextFiles(dir: string, recursive: boolean, filter: RegExp): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childAbs = path.join(abs, e.name);
      const childRel = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (recursive && e.name !== 'node_modules') walk(childAbs, childRel);
      } else if (filter.test(childRel)) {
        out.push(childRel);
      }
    }
  };
  walk(dir, '.');
  return out;
}

// ---------------------------------------------------------------- bundle

export async function bundle(opts: BundleOptions): Promise<BundleResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const log = opts.log ?? (() => {});
  const { projectRoot, platform, dev } = opts;
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
  const customTransformOptions: Record<string, string> = {
    engine: 'hermes',
    bytecode: '1',
    routerRoot: opts.routerRoot ?? 'src/app',
    reactCompiler: String(!!readAppJson(projectRoot)?.expo?.experiments?.reactCompiler),
    baseUrl: '',
  };

  const resolver = new Resolver({
    projectRoot,
    platform,
    sourceExts: SOURCE_EXTS,
    assetExts: ASSET_EXTS,
    tsconfigPaths: readTsconfigPaths(projectRoot),
    virtualModules: { [EXTERNAL_REQUIRE_POLYFILL]: '', [ENV_VARS_POLYFILL]: '' },
  });
  const projectPkg = path.join(projectRoot, 'package.json');
  const resolveFromRoot = (spec: string) => {
    const r = resolver.resolve(spec, projectPkg, false);
    if (r.type !== 'sourceFile') throw new Error(`Cannot resolve ${spec}`);
    return r.filePath;
  };

  const runBeforeMain = [
    resolveFromRoot('react-native/Libraries/Core/InitializeCore'),
    resolveFromRoot('expo/src/winter'),
    resolveFromRoot('@expo/metro-runtime'),
  ];
  const entry = path.resolve(projectRoot, opts.entryFile);
  const polyfillFiles = [
    ...(projectRequire('@react-native/js-polyfills')() as string[]),
    EXTERNAL_REQUIRE_POLYFILL,
    ENV_VARS_POLYFILL,
    resolveFromRoot('expo/virtual/streams.js'),
  ];

  const pool = new TransformPool(opts.workers ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1));
  // In-memory transform results, so link retries (missing-export stubs) do not re-run Babel.
  const transformed = new Map<string, Promise<TransformResponse>>();
  const transformJs = (filename: string, type: 'module' | 'script', src?: string) => {
    const key = `${type}:${filename}`;
    let p = transformed.get(key);
    if (!p) {
      p = transformJsUncached(filename, type, src);
      transformed.set(key, p);
    }
    return p;
  };
  // Persistent transform cache (Bun.hash + Bun.file/Bun.write): content + options + toolchain versions.
  const cacheDir = path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler', `${platform}-${dev ? 'dev' : 'prod'}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheSalt = JSON.stringify({
    v: BUNDLER_CACHE_VERSION,
    customTransformOptions,
    preset: projectRequire('babel-preset-expo/package.json').version,
    metroConfig: projectRequire('@expo/metro-config/package.json').version,
    env: Object.entries(process.env).filter(([k]) => k.startsWith('EXPO_PUBLIC_')).sort(),
  });
  let cacheHits = 0;
  const transformJsUncached = async (filename: string, type: 'module' | 'script', src?: string) => {
    const source = src ?? fs.readFileSync(filename, 'utf8');
    const key = Bun.hash(`${cacheSalt}\0${type}\0${filename}\0${source}`).toString(36);
    const cacheFile = path.join(cacheDir, `${key}.json`);
    if (!opts.resetCache) {
      const cached = Bun.file(cacheFile);
      if (await cached.exists()) {
        cacheHits++;
        return (await cached.json()) as TransformResponse;
      }
    }
    const res = await pool.run({
      filename,
      src: source,
      projectRoot,
      platform,
      dev,
      type,
      customTransformOptions,
    });
    if (res.error) throw new Error(res.error);
    await Bun.write(cacheFile, JSON.stringify({ code: res.code, map: res.map }));
    if (process.env.BUN_BUNDLER_DEBUG) debugCount.n++ % 200 === 0 && console.error(`[bun-bundler] transformed ${debugCount.n} files`);
    return res;
  };

  const modules = new Set<string>();
  const assets: AssetData[] = [];
  // Bun does not carry `pluginData` from onResolve to onLoad: keep per-path data here.
  const assetFilesByPath = new Map<string, string[]>();
  // Imports of names a module does not export (typically TypeScript types re-exported without
  // `export type`). Metro yields `undefined` at runtime; Bun fails linking. Stub them as undefined.
  const missingExports = new Map<string, Set<string>>();
  // Babel source maps per file: Bun maps the bundle to the Babel output only; composed at the end.
  const babelMaps = new Map<string, any>();

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
          const imports = [...runBeforeMain, entry].map((f) => `import ${JSON.stringify(f)};`).join('\n');
          return { contents: imports, loader: 'js' };
        }
        if (args.path === ASSET_REGISTRY_VIRTUAL) return { contents: ASSET_REGISTRY_SRC, loader: 'js' };
        throw new Error(`Unknown virtual module ${args.path}`);
      });

      build.onLoad({ filter: /.*/, namespace: 'rn-empty' }, () => ({ contents: '', loader: 'js' }));

      build.onLoad({ filter: /.*/, namespace: 'rn-asset' }, (args) => {
        const data = getAssetData(assetFilesByPath.get(args.path)!, projectRoot);
        assets.push(data);
        for (const f of data.files) modules.add(f);
        return { contents: assetModuleSource(data, '@react-native/assets-registry/registry'), loader: 'js' };
      });

      build.onLoad({ filter: /.*/, namespace: 'rn-context' }, (args) => {
        const spec = JSON.parse(args.path.slice(REQUIRE_CONTEXT_PREFIX.length));
        const dir = spec.dir;
        const files = listContextFiles(dir, spec.recursive, new RegExp(spec.filter.pattern, spec.filter.flags));
        const entries = files
          .map((rel) => `  ${JSON.stringify(rel)}: () => require(${JSON.stringify(path.join(dir, rel))}),`)
          .join('\n');
        const contents = `var map = {\n${entries}\n};
function ctx(key) { var f = map[key]; if (!f) { var e = new Error("Cannot find module '" + key + "'"); e.code = 'MODULE_NOT_FOUND'; throw e; } return f(); }
ctx.keys = function () { return Object.keys(map); };
ctx.resolve = function (key) { return key; };
ctx.id = ${JSON.stringify(path.relative(projectRoot, dir))};
module.exports = ctx;`;
        return { contents, loader: 'js', resolveDir: dir };
      });

      build.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
        const file = args.path;
        modules.add(file);
        const ext = path.extname(file).slice(1);
        if (ext === 'json') return { contents: fs.readFileSync(file, 'utf8'), loader: 'json' };
        if (ext === 'css' || ext === 'scss' || ext === 'sass') return { contents: '', loader: 'js' }; // native: no CSS
        const { code, map } = await transformJs(file, 'module');
        const stubs = missingExports.get(file);
        const stubCode = stubs ? '\n' + [...stubs].map((n) => `export var ${n} = void 0;`).join('\n') : '';
        if (map) babelMaps.set(file, map);
        return { contents: code! + stubCode, loader: 'js' };
      });
    },
  };

  // ---- polyfills (scripts, transformed like Metro's `type: 'script'` and wrapped with `global`)
  const tPoly = performance.now();
  const polyfillSources: string[] = [];
  for (const f of polyfillFiles) {
    let code: string;
    if (f === EXTERNAL_REQUIRE_POLYFILL) {
      code = 'try { global.$$require_external = typeof expo === "undefined" ? require : (moduleId) => { throw new Error(`Node.js standard library module ${moduleId} is not available in this JavaScript environment`);} } catch { global.$$require_external = (moduleId) => { throw new Error(`Node.js standard library module ${moduleId} is not available in this JavaScript environment`);} }';
    } else if (f === ENV_VARS_POLYFILL) {
      code = '//';
    } else {
      code = (await transformJs(f, 'script')).code ?? '';
      modules.add(f);
    }
    polyfillSources.push(`(function (global) {\n${code}\n})(${SCRIPT_WRAPPER_GLOBAL});`);
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
      define: {
        __DEV__: String(dev),
        'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
        global: 'globalThis',
      },
      throw: false,
    } as any);
    if (process.env.BUN_BUNDLER_DEBUG) console.error(`[bun-bundler] build attempt ${attempt}: success=${result.success} logs=${result.logs.length}`);
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
    pool.close();
  }
  timings.build = performance.now() - tBuild;
  if (!result.success) {
    const msg = result.logs.map((l: any) => String(l)).join('\n');
    throw new Error(`Bun.build failed:\n${msg}`);
  }
  const jsOut = result.outputs.find((o: any) => o.kind === 'entry-point')!;
  const mainCode = (await jsOut.text()).replace(/\n?\/\/# (sourceMappingURL|debugId)=.*$/gm, '');

  // ---- prelude + polyfills + module graph
  const prelude =
    `var __BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now(),__DEV__=${dev},` +
    `process=globalThis.process||{},__METRO_GLOBAL_PREFIX__='';process.env=process.env||{};` +
    `process.env.NODE_ENV=process.env.NODE_ENV||${JSON.stringify(dev ? 'development' : 'production')};`;
  // Dev: Babel adds React Refresh registrations and RN's setUpReactRefresh assigns `require.Refresh`.
  // Without Metro's module runtime (no Fast Refresh yet) provide inert globals for both.
  const devPrelude = dev
    ? `var $RefreshReg$=function(){},$RefreshSig$=function(){return function(t){return t}};` +
      `var require=globalThis.require||function(id){throw new Error('Cannot require "'+id+'" at runtime in a Bun bundle')};`
    : '';
  const head = [prelude + devPrelude, ...polyfillSources].join('\n') + '\n';
  const bundleCode = head + mainCode + '\n';
  fs.mkdirSync(path.dirname(opts.bundleOutput), { recursive: true });
  fs.writeFileSync(opts.bundleOutput, bundleCode);

  if (opts.sourcemapOutput) {
    const smOut = result.outputs.find((o: any) => o.kind === 'sourcemap');
    const bunMap = smOut ? JSON.parse(await smOut.text()) : { version: 3, sources: [], names: [], mappings: '' };
    // bundle -> Babel output (Bun) composed with Babel output -> original source (per file).
    const remapping = projectRequire('@jridgewell/remapping');
    // Only Bun's sources (project-relative) get a Babel map; Babel maps point at absolute original files,
    // which must end the chain (returning a map for them again would recurse forever).
    const map: any = remapping(bunMap, (source: string) => {
      if (path.isAbsolute(source)) return null;
      return babelMaps.get(path.resolve(projectRoot, source)) ?? null;
    });
    // Shift the module-graph mappings below the (unmapped) prelude and polyfills.
    const headLines = head.split('\n').length - 1;
    map.mappings = ';'.repeat(headLines) + map.mappings;
    map.sources = map.sources.map((s: string) => (path.isAbsolute(s) ? path.relative(projectRoot, s) : s));
    fs.writeFileSync(opts.sourcemapOutput, JSON.stringify(map));
  }

  if (opts.assetsDest) {
    const copied = saveAssets(assets, platform, opts.assetsDest);
    log(`Copied ${copied} asset files`);
  }

  timings.total = performance.now() - t0;
  timings.cacheHits = cacheHits;
  return { modules: [...modules], assets, timings };
}

function readAppJson(projectRoot: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'));
  } catch {
    return null;
  }
}
