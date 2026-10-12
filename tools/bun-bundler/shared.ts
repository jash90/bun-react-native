// Shared pieces of the Bun bundler: project context (resolver, Expo transform options, run-before-main
// modules, polyfills, prelude), the Babel worker pool and the persistent transform cache.
// Used by the production bundler (bundle.ts, Bun.build) and the dev graph (dev-graph.ts, Metro module format).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { Resolver } from './resolver';
import type { TransformRequest, TransformResponse } from './transform-worker';

export const SOURCE_EXTS = ['ts', 'tsx', 'mjs', 'js', 'jsx', 'json', 'cjs', 'scss', 'sass', 'css'];
export const ASSET_EXTS = ['bmp', 'gif', 'jpg', 'jpeg', 'png', 'psd', 'svg', 'webp', 'xml', 'm4v', 'mov', 'mp4', 'mpeg', 'mpg', 'webm', 'aac', 'aiff', 'caf', 'm4a', 'mp3', 'wav', 'html', 'pdf', 'yaml', 'yml', 'otf', 'ttf', 'zip', 'heic', 'avif', 'db'];

export const EXTERNAL_REQUIRE_POLYFILL = '\0polyfill:external-require';
export const ENV_VARS_POLYFILL = '\0polyfill:environment-variables';
export const ASSET_REGISTRY_SRC = `const assets=[];module.exports={registerAsset:s=>assets.push(s),getAssetByID:s=>assets[s-1]};`;
export const SCRIPT_WRAPPER_GLOBAL = `typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : this`;
const EXTERNAL_REQUIRE_WEB_SRC = `global.$$require_external = typeof require !== "undefined" ? (m) => require(m) : () => null;`;
const EXTERNAL_REQUIRE_SRC =
  'try { global.$$require_external = typeof expo === "undefined" ? require : (moduleId) => { throw new Error(`Node.js standard library module ${moduleId} is not available in this JavaScript environment`);} } catch { global.$$require_external = (moduleId) => { throw new Error(`Node.js standard library module ${moduleId} is not available in this JavaScript environment`);} }';

const BUNDLER_CACHE_VERSION = 2; // bump when the transform pipeline changes

// ---------------------------------------------------------------- Babel worker pool

export class TransformPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { req: Omit<TransformRequest, 'id'>; resolve: (r: TransformResponse) => void }[] = [];
  private pending = new Map<number, (r: TransformResponse) => void>();
  private owner = new Map<number, Worker>();
  private nextId = 1;
  private size: number;

  constructor(size: number) {
    this.size = size;
  }

  private start() {
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL('./transform-worker.ts', import.meta.url).href);
      const failOwned = (error: string) => {
        // a crashed/exited worker must not leave callers waiting forever
        for (const [id, done] of this.pending) {
          if (this.owner.get(id) === w) {
            this.pending.delete(id);
            this.owner.delete(id);
            done({ id, error });
          }
        }
      };
      w.onerror = (e: ErrorEvent) => failOwned(`transform worker crashed: ${e.message}`);
      w.addEventListener('close', () => {
        failOwned('transform worker exited unexpectedly');
        this.idle = this.idle.filter((x) => x !== w);
      });
      w.onmessage = (e: MessageEvent<TransformResponse>) => {
        this.owner.delete(e.data.id);
        const done = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        this.idle.push(w);
        done?.(e.data);
        this.pump();
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  run(req: Omit<TransformRequest, 'id'>): Promise<TransformResponse> {
    if (!this.workers.length) this.start(); // lazily: a fully cached build never spawns workers
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
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}

// ---------------------------------------------------------------- project context

export type Platform = 'ios' | 'android' | 'web';

export interface ProjectOptions {
  projectRoot: string;
  platform: Platform;
  dev: boolean;
  /** web only: 'node' builds the server (static rendering) bundle */
  environment?: 'client' | 'node';
  routerRoot?: string;
  workers?: number;
  resetCache?: boolean;
}

export type TransformFormat = 'esm' | 'metro';

export function readTsconfigPaths(projectRoot: string) {
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

export function readAppJson(projectRoot: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Files matched by `require.context(dir, recursive, filter)` as `./relative` keys (Metro semantics). */
export function listContextFiles(dir: string, recursive: boolean, filter: RegExp): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (recursive && e.name !== 'node_modules') walk(path.join(abs, e.name), childRel);
      } else if (filter.test(childRel)) {
        out.push(childRel);
      }
    }
  };
  walk(dir, '.');
  return out;
}

/** CommonJS source of a `require.context` module: `ctx(key)`, `ctx.keys()`, `ctx.resolve(key)`, `ctx.id`. */
export function requireContextSource(projectRoot: string, spec: { dir: string; recursive: boolean; filter: { pattern: string; flags: string } }) {
  const files = listContextFiles(spec.dir, spec.recursive, new RegExp(spec.filter.pattern, spec.filter.flags));
  const entries = files.map((rel) => `  ${JSON.stringify(rel)}: () => require(${JSON.stringify(path.join(spec.dir, rel))}),`).join('\n');
  return `var map = {\n${entries}\n};
function ctx(key) { var f = map[key]; if (!f) { var e = new Error("Cannot find module '" + key + "'"); e.code = 'MODULE_NOT_FOUND'; throw e; } return f(); }
ctx.keys = function () { return Object.keys(map); };
ctx.resolve = function (key) { return key; };
ctx.id = ${JSON.stringify(path.relative(projectRoot, spec.dir))};
module.exports = ctx;`;
}

export function createProject(opts: ProjectOptions) {
  const { projectRoot, platform, dev } = opts;
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
  const isWeb = platform === 'web';
  const isServer = isWeb && opts.environment === 'node';
  const customTransformOptions: Record<string, string> = {
    ...(isWeb ? {} : { engine: 'hermes', bytecode: '1' }),
    ...(isServer ? { environment: 'node' } : {}),
    routerRoot: opts.routerRoot ?? 'src/app',
    reactCompiler: String(!!readAppJson(projectRoot)?.expo?.experiments?.reactCompiler),
    baseUrl: '',
  };
  let shimsDir: string | null = null;
  try {
    shimsDir = isWeb ? path.join(path.dirname(projectRequire.resolve('@expo/cli/package.json')), 'static', 'shims') : null;
  } catch {}
  const resolver = new Resolver({
    projectRoot,
    platform,
    sourceExts: SOURCE_EXTS,
    assetExts: ASSET_EXTS,
    tsconfigPaths: readTsconfigPaths(projectRoot),
    virtualModules: { [EXTERNAL_REQUIRE_POLYFILL]: '', [ENV_VARS_POLYFILL]: '' },
    ...(isWeb
      ? {
          // Expo web: browser fields for the client, Node resolution for the static-rendering server
          mainFields: isServer ? ['main', 'module'] : ['browser', 'module', 'main'],
          conditionsByPlatform: { web: isServer ? ['node'] : ['browser'] },
          preferNativePlatform: false,
          exactAliases: {
            'react-native': 'react-native-web',
            'react-native/index': 'react-native-web',
            'react-native/Libraries/Image/resolveAssetSource': 'expo-asset/build/resolveAssetSource',
          },
          shimsDir,
          browserNodeBuiltins: !isServer,
        }
      : {}),
  });
  const projectPkg = path.join(projectRoot, 'package.json');
  const resolveFromRoot = (spec: string) => {
    const r = resolver.resolve(spec, projectPkg, false);
    if (r.type !== 'sourceFile') throw new Error(`Cannot resolve ${spec}`);
    return r.filePath;
  };
  // Metro only runs the run-before-main modules that exist for the platform (InitializeCore is native-only)
  const runBeforeMain = isWeb
    ? [resolveFromRoot('expo/src/winter'), resolveFromRoot('@expo/metro-runtime')]
    : [
        resolveFromRoot('react-native/Libraries/Core/InitializeCore'),
        resolveFromRoot('expo/src/winter'),
        resolveFromRoot('@expo/metro-runtime'),
      ];
  const rnPolyfills = projectRequire('@react-native/js-polyfills')() as string[];
  const polyfillFiles = isWeb
    ? [EXTERNAL_REQUIRE_POLYFILL, ENV_VARS_POLYFILL, ...rnPolyfills.filter((p) => !p.includes('/console'))]
    : [...rnPolyfills, EXTERNAL_REQUIRE_POLYFILL, ENV_VARS_POLYFILL, resolveFromRoot('expo/virtual/streams.js')];

  // ---- Babel worker pool + transform cache (Bun.hash + Bun.file/Bun.write)
  const pool = new TransformPool(opts.workers ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1));
  const cacheDir = path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler', `${platform}${isServer ? '-server' : ''}-${dev ? 'dev' : 'prod'}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheSalt = JSON.stringify({
    v: BUNDLER_CACHE_VERSION,
    customTransformOptions,
    preset: projectRequire('babel-preset-expo/package.json').version,
    metroConfig: projectRequire('@expo/metro-config/package.json').version,
    env: Object.entries(process.env).filter(([k]) => k.startsWith('EXPO_PUBLIC_')).sort(),
  });
  const stats = { cacheHits: 0, transformed: 0 };

  async function transform(filename: string, type: 'module' | 'script', format: TransformFormat, src?: string): Promise<TransformResponse> {
    const source = src ?? fs.readFileSync(filename, 'utf8');
    const key = Bun.hash(`${cacheSalt}\0${format}\0${type}\0${filename}\0${source}`).toString(36);
    const cacheFile = path.join(cacheDir, `${key}.json`);
    if (!opts.resetCache) {
      const cached = Bun.file(cacheFile);
      if (await cached.exists()) {
        stats.cacheHits++;
        return (await cached.json()) as TransformResponse;
      }
    }
    const res = await pool.run({ filename, src: source, projectRoot, platform, dev, type, format, customTransformOptions });
    if (res.error) throw new Error(res.error);
    stats.transformed++;
    await Bun.write(cacheFile, JSON.stringify({ code: res.code, map: res.map, deps: res.deps, esmDeps: res.esmDeps }));
    return res;
  }

  /** Metro-compatible prelude (globals the React Native runtime expects before any module runs). */
  function prelude(extra = '') {
    return (
      `var __BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now(),__DEV__=${dev},` +
      `process=globalThis.process||{},__METRO_GLOBAL_PREFIX__='';process.env=process.env||{};` +
      `process.env.NODE_ENV=process.env.NODE_ENV||${JSON.stringify(dev ? 'development' : 'production')};` +
      extra
    );
  }

  /** Polyfills, transformed as scripts and wrapped with `global` exactly like Metro. */
  async function polyfillSources(): Promise<string[]> {
    const out: string[] = [];
    for (const f of polyfillFiles) {
      let code: string;
      if (f === EXTERNAL_REQUIRE_POLYFILL) code = isWeb ? EXTERNAL_REQUIRE_WEB_SRC : EXTERNAL_REQUIRE_SRC;
      else if (f === ENV_VARS_POLYFILL) code = '//';
      else code = (await transform(f, 'script', 'esm')).code ?? '';
      out.push(`(function (global) {\n${code}\n})(${SCRIPT_WRAPPER_GLOBAL});`);
    }
    return out;
  }

  return {
    projectRoot,
    platform,
    dev,
    isWeb,
    isServer,
    projectRequire,
    projectPkg,
    resolver,
    runBeforeMain,
    polyfillFiles,
    customTransformOptions,
    transform,
    prelude,
    polyfillSources,
    stats,
    close: () => pool.close(),
  };
}

export type Project = ReturnType<typeof createProject>;
