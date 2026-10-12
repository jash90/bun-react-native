// Shared pieces of the Bun bundler: project context (resolver, Expo transform options, run-before-main
// modules, polyfills, prelude), the Babel worker pool and the persistent transform cache.
// Used by the production bundler (bundle.ts, Bun.build) and the dev graph (dev-graph.ts, Metro module format).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { Resolver } from './resolver';
import type { FunctionMap, MapPiece } from './sourcemap';
import { TransformPool } from './transform-pool';
import { metroEngineDecision } from './metro-config-support';
import type { TransformResponse } from './transform-worker';

export const SOURCE_EXTS = ['ts', 'tsx', 'mjs', 'js', 'jsx', 'json', 'cjs', 'scss', 'sass', 'css'];
export const ASSET_EXTS = ['bmp', 'gif', 'jpg', 'jpeg', 'png', 'psd', 'svg', 'webp', 'xml', 'm4v', 'mov', 'mp4', 'mpeg', 'mpg', 'webm', 'aac', 'aiff', 'caf', 'm4a', 'mp3', 'wav', 'html', 'pdf', 'yaml', 'yml', 'otf', 'ttf', 'zip', 'heic', 'avif', 'db'];

export const EXTERNAL_REQUIRE_POLYFILL = '\0polyfill:external-require';
export const ENV_VARS_POLYFILL = '\0polyfill:environment-variables';
/** an optional dependency that does not resolve: throws when required, like Metro's unresolved optional deps */
export const MISSING_MODULE_NAMESPACE = 'rn-missing';
export const missingModuleSource = (spec: string) =>
  `var e = new Error(${JSON.stringify(`Cannot find module '${spec}'`)}); e.code = 'MODULE_NOT_FOUND'; throw e;`;
export const ASSET_REGISTRY_SRC = `const assets=[];module.exports={registerAsset:s=>assets.push(s),getAssetByID:s=>assets[s-1]};`;
export const SCRIPT_WRAPPER_GLOBAL = `typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : this`;
const EXTERNAL_REQUIRE_WEB_SRC = `global.$$require_external = typeof require !== "undefined" ? (m) => require(m) : () => null;`;
const EXTERNAL_REQUIRE_SRC =
  'try { global.$$require_external = typeof expo === "undefined" ? require : (moduleId) => { throw new Error(`Node.js standard library module ${moduleId} is not available in this JavaScript environment`);} } catch { global.$$require_external = (moduleId) => { throw new Error(`Node.js standard library module ${moduleId} is not available in this JavaScript environment`);} }';

const BUNDLER_CACHE_VERSION = 8; // bump when the transform pipeline changes

// ---------------------------------------------------------------- project context

export type Platform = 'ios' | 'android' | 'web' | 'tvos' | 'macos';

export interface ProjectOptions {
  projectRoot: string;
  platform: Platform;
  dev: boolean;
  /** web only: 'node' builds the server (static rendering) bundle */
  environment?: 'client' | 'node';
  routerRoot?: string;
  /** evaluated Expo config (read with @expo/config when omitted) */
  exp?: any;
  workers?: number;
  resetCache?: boolean;
  /** minified export (passed to the transformer like Metro's `minify`; default: production) */
  minify?: boolean;
  /** expo-router loader bundle: only the route's `loader` export is kept (`isLoaderBundle`) */
  loaderBundle?: boolean;
  /** DOM component bundle: the `"use dom"` file (relative import from expo/dom/entry.js, URI-encoded) */
  dom?: string;
  /**
   * babel-preset-expo `unstable_transformProfile` (`--unstable-transform-profile`); default like Expo export:embed:
   * `hermes-stable` for Hermes, `default` for JSC and web
   */
  transformProfile?: string;
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

/** Evaluated Expo config (app.json / app.config.*, config plugins' `extra`), the way Expo CLI reads it. */
export function getExpoConfig(projectRoot: string): any {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const { getConfig } = req('@expo/config');
  return getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp;
}

/** Expo Router directory (`src/app` or `app`, or the plugin's `root`), from Expo CLI. */
export function getRouterRoot(projectRoot: string, exp = getExpoConfig(projectRoot)): string {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  return req('@expo/cli/build/src/start/server/metro/router').getRouterDirectoryModuleIdWithManifest(projectRoot, exp);
}

/** expo-router `asyncRoutes` for a mode and platform (Expo CLI getAsyncRoutesFromExpoConfig). */
export function getAsyncRoutes(projectRoot: string, exp: any, mode: string, platform: string): boolean {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  return req('@expo/cli/build/src/start/server/middleware/metroOptions').getAsyncRoutesFromExpoConfig(exp, mode, platform);
}

/** `experiments.baseUrl` without trailing slashes ('' when unset), from Expo CLI. */
export function getBaseUrl(projectRoot: string, exp = getExpoConfig(projectRoot)): string {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  return req('@expo/cli/build/src/start/server/middleware/metroOptions').getBaseUrlFromExpoConfig(exp);
}

/**
 * Paths of a Bun.build metafile walked depth-first from `entry`, dependencies in import order (Bun keeps source
 * order): `pre` = first-visit order (Metro's graph order), `post` = after the dependencies (Metro's CSS order).
 * Plugin namespaces (`rn-asset:/abs/path`) are stripped; relative keys are resolved against the cwd.
 */
export function metafileOrder(metafile: any, entry: string): { pre: string[]; post: string[] } {
  // keys are relative to Bun's working directory; compare real paths (the resolver returns real paths)
  const real = new Map<string, string>();
  const norm = (p: string) => {
    const bare = p.replace(/^[a-z][a-z-]*:(?=[/\0])/, '');
    if (bare.startsWith('\0')) return bare;
    const abs = path.isAbsolute(bare) ? bare : path.resolve(bare);
    let r = real.get(abs);
    if (r === undefined) {
      try {
        r = fs.realpathSync(abs);
      } catch {
        r = abs;
      }
      real.set(abs, r);
    }
    return r;
  };
  // with code splitting, `import()` edges point at output chunks; `entryPoint` is the imported source module
  const target = (i: any) => norm(i.entryPoint ?? i.path);
  const graph = new Map<string, string[]>();
  for (const [k, v] of Object.entries<any>(metafile?.inputs ?? {})) graph.set(norm(k), (v.imports ?? []).map(target));
  const pre: string[] = [];
  const post: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    pre.push(file);
    for (const dep of graph.get(file) ?? []) visit(dep);
    post.push(file);
  };
  visit(norm(entry));
  return { pre, post };
}

/**
 * Strict mode for an IIFE bundle (`(() => { ... })()`): Metro runs every ES module in strict mode (`"use strict"`
 * per module, @expo/metro-config applyUseStrictDirective) and the dev graph does too (Babel's CommonJS transform);
 * Bun hoists ES modules into one function without it. The directive goes first in that function; generated columns
 * of the first line shift in the (Bun) source map.
 */
export function strictIife(code: string, map: any | null, projectRequire: NodeRequire): { code: string; map: any | null } {
  const m = code.match(/^\(\(\)\s*=>\s*\{/);
  if (!m) return { code, map };
  const directive = '"use strict";';
  const at = m[0].length;
  const out = code.slice(0, at) + directive + code.slice(at);
  if (!map?.mappings) return { code: out, map };
  const { decode, encode } = projectRequire('@jridgewell/sourcemap-codec');
  const lines = decode(map.mappings);
  if (lines[0]) lines[0] = lines[0].map((seg: number[]) => (seg[0] >= at ? [seg[0] + directive.length, ...seg.slice(1)] : seg));
  return { code: out, map: { ...map, mappings: encode(lines) } };
}

/** Files matched by `require.context(dir, recursive, filter)` as `./relative` keys, sorted by path like Metro. */
export function listContextFiles(dir: string, recursive: boolean, filter: RegExp): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (recursive && e.name !== 'node_modules') walk(path.join(abs, e.name), childRel);
      } else if (filter.test(childRel)) {
        out.push(childRel);
      }
    }
  };
  walk(dir, '.');
  return out.sort(); // metro createFileMap: files.slice().sort()
}

export interface ContextSpec {
  dir: string;
  recursive: boolean;
  filter: { pattern: string; flags: string };
  mode: string;
}

/**
 * metro/src/lib/contextModuleTemplates.js: the `require.context` module. Modules sit behind enumerable getters,
 * `ctx(key)` returns `map[key]` (undefined for unknown keys; expo-router relies on it for generated routes), an
 * empty context throws MODULE_NOT_FOUND, `resolve` is unimplemented. `load(i)` returns the code loading file i.
 */
export function contextModuleSource(spec: ContextSpec, files: string[], load: (i: number) => string): string {
  if (!files.length) {
    return `function metroEmptyContext(request) {
  let e = new Error('No modules in context');
  e.code = 'MODULE_NOT_FOUND';
  throw e;
}
metroEmptyContext.keys = () => ([]);
metroEmptyContext.resolve = function metroContextResolve(request) {
  throw new Error('Unimplemented Metro module context functionality');
}
module.exports = metroEmptyContext;`;
  }
  const body =
    spec.mode === 'eager'
      ? 'return Promise.resolve().then(() => map[request]);'
      : spec.mode === 'sync' || spec.mode === 'lazy' || spec.mode === 'lazy-once'
        ? 'return map[request];'
        : null;
  if (body == null) throw new Error(`require.context: unsupported mode "${spec.mode}"`);
  const entries = files.map((rel, i) => `  ${JSON.stringify(rel)}: { enumerable: true, get() { return ${load(i)}; } },`).join('\n');
  return `const map = Object.defineProperties({}, {
${entries}
});
function metroContext(request) {
  ${body}
}
metroContext.keys = function metroContextKeys() {
  return Object.keys(map);
};
metroContext.resolve = function metroContextResolve(request) {
  throw new Error('Unimplemented Metro module context functionality');
}
module.exports = metroContext;`;
}

/** `require.context` module for Bun.build (absolute requires; `lazy` modes use import() like Metro). */
export function requireContextSource(projectRoot: string, spec: ContextSpec) {
  void projectRoot;
  const files = listContextFiles(spec.dir, spec.recursive, new RegExp(spec.filter.pattern, spec.filter.flags));
  const lazy = spec.mode === 'lazy' || spec.mode === 'lazy-once';
  return contextModuleSource(spec, files, (i) => `${lazy ? 'import' : 'require'}(${JSON.stringify(path.join(spec.dir, files[i]))})`);
}

/** @expo/config PLATFORM_EXTENSIONS (out-of-tree platforms resolve through their host platform's files) */
const OUT_OF_TREE_PLATFORM_EXTENSIONS: Record<string, string[]> = { tvos: ['tvos', 'ios', 'native'], macos: ['macos', 'ios', 'native'] };

/** Expo getNodejsExtensions: server bundles sort `*.mjs` after the `*.js`-like extensions */
function nodejsSourceExts(exts: string[]) {
  const mjs = exts.filter((e) => /mjs$/.test(e));
  const rest = exts.filter((e) => !/mjs$/.test(e));
  const jsIndex = rest.reduce((index, e, i) => (/jsx?$/.test(e) ? i : index), -1);
  rest.splice(jsIndex + 1, 0, ...mjs);
  return rest;
}

/**
 * Expo autolinking module resolution input (createAutolinkingModuleResolverInput), enabled like Expo CLI: in a
 * monorepo, for out-of-tree platforms (tvOS/macOS) or with `experiments.autolinkingModuleResolution`. Computed in a
 * child process (the scan is async) and cached per project/platform.
 */
const autolinkingCache = new Map<string, any>();
function autolinkingInput(projectRoot: string, exp: any, platform: string) {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const isWorkspace = req('@expo/config/paths').getMetroServerRoot(projectRoot) !== projectRoot;
  const configPlatforms: string[] = req('@expo/config').getPlatformsFromConfig?.(projectRoot, exp) ?? exp.platforms ?? [];
  const outOfTree = configPlatforms.some((p) => p === 'tvos' || p === 'macos');
  const enabled = exp.experiments?.autolinkingModuleResolution ?? (isWorkspace || outOfTree);
  if (!enabled || platform === 'web') return null;
  const key = `${projectRoot}\0${platform}`;
  if (!autolinkingCache.has(key)) {
    const modulePath = req.resolve('@expo/cli/build/src/start/server/metro/createExpoAutolinkingResolver');
    const script = `require(${JSON.stringify(modulePath)}).createAutolinkingModuleResolverInput({ platforms: [${JSON.stringify(platform)}], projectRoot: ${JSON.stringify(projectRoot)} }).then((r) => { for (const v of Object.values(r)) v.moduleTestRe = v.moduleTestRe.source; process.stdout.write(JSON.stringify(r)); })`;
    const out = Bun.spawnSync([process.execPath, '-e', script], { cwd: projectRoot, stdout: 'pipe', stderr: 'inherit' });
    const parsed = JSON.parse(out.stdout.toString() || '{}');
    for (const v of Object.values<any>(parsed)) v.moduleTestRe = new RegExp(v.moduleTestRe);
    autolinkingCache.set(key, parsed);
  }
  return autolinkingCache.get(key);
}

export function createProject(opts: ProjectOptions) {
  const { projectRoot, platform, dev } = opts;
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
  const isWeb = platform === 'web';
  const isServer = isWeb && opts.environment === 'node';
  const exp = opts.exp ?? getExpoConfig(projectRoot);
  const routerRoot = opts.routerRoot ?? getRouterRoot(projectRoot, exp);
  const baseUrl = getBaseUrl(projectRoot, exp);
  // Expo: `engine: hermes` (+ `bytecode` for Hermes exports) only when the platform uses Hermes; JSC gets neither
  const isHermes = !isWeb && projectRequire('@expo/cli/build/src/export/exportHermes').isEnableHermesManaged(exp, platform);
  const customTransformOptions: Record<string, string> = {
    ...(isHermes ? { engine: 'hermes', bytecode: '1' } : {}),
    ...(isServer ? { environment: 'node' } : {}),
    routerRoot,
    reactCompiler: String(!!exp.experiments?.reactCompiler),
    baseUrl,
    // expo-router `asyncRoutes` (Expo CLI getAsyncRoutesFromExpoConfig); server bundles never split
    ...(!isServer && getAsyncRoutes(projectRoot, exp, dev ? 'development' : 'production', platform) ? { asyncRoutes: 'true' } : {}),
    ...(opts.loaderBundle ? { isLoaderBundle: 'true' } : {}),
    ...(opts.dom ? { dom: opts.dom } : {}),
  };
  const minify = opts.minify ?? !dev;
  let shimsDir: string | null = null;
  try {
    shimsDir = isWeb ? path.join(path.dirname(projectRequire.resolve('@expo/cli/package.json')), 'static', 'shims') : null;
  } catch {}
  const reactNativeHostPackage: string =
    isWeb ? 'react-native-web' : projectRequire('expo/internal/unstable-autolinking-exports').getSupportPackageForPlatform(platform) ?? 'react-native';
  // metro.config.js: extensions and a custom Babel transformer (projects with other customizations use Metro)
  const decision = metroEngineDecision(projectRoot);
  const metroConfig = decision.engine === 'bun' ? decision.config : { sourceExts: SOURCE_EXTS, assetExts: ASSET_EXTS, babelTransformerPath: null };
  const resolver = new Resolver({
    projectRoot,
    platform,
    sourceExts: isServer ? nodejsSourceExts(metroConfig.sourceExts) : metroConfig.sourceExts,
    dev,
    server: isServer,
    reactNativeHostPackage,
    platformExtensions: OUT_OF_TREE_PLATFORM_EXTENSIONS[platform],
    autolinking: autolinkingInput(projectRoot, exp, platform),
    assetExts: metroConfig.assetExts,
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
  const transformProfile = opts.transformProfile ?? (isHermes ? 'hermes-stable' : 'default');
  const pool = new TransformPool(opts.workers ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1));
  const cacheDir = path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler', `${platform}${isServer ? '-server' : ''}-${dev ? 'dev' : 'prod'}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheSalt = JSON.stringify({
    transformProfile,
    v: BUNDLER_CACHE_VERSION,
    customTransformOptions,
    minify,
    preset: projectRequire('babel-preset-expo/package.json').version,
    metroConfig: projectRequire('@expo/metro-config/package.json').version,
    env: Object.entries(process.env).filter(([k]) => k.startsWith('EXPO_PUBLIC_')).sort(),
    // like Expo's transformer cache key: the project's Babel config files (contents), and a custom transformer
    babelConfig: projectRequire('@expo/metro-config/build/babel-transformer').getCacheKey({ projectRoot }),
    babelTransformer: metroConfig.babelTransformerPath && [metroConfig.babelTransformerPath, Bun.hash(fs.readFileSync(metroConfig.babelTransformerPath)).toString(36)],
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
    const res = await pool.run({ filename, src: source, projectRoot, platform, dev, minify, type, format, customTransformOptions, transformProfile, babelTransformerPath: metroConfig.babelTransformerPath });
    if (res.error) throw new Error(res.error);
    stats.transformed++;
    await Bun.write(cacheFile, JSON.stringify({ code: res.code, map: res.map, deps: res.deps, esmDeps: res.esmDeps, asyncDeps: res.asyncDeps, loaderReference: res.loaderReference, domComponentReference: res.domComponentReference, optionalDeps: res.optionalDeps, functionMap: res.functionMap }));
    return res;
  }

  /**
   * Metro-compatible prelude (globals the React Native runtime expects before any module runs). Server bundles
   * keep the real `process` (Expo's serverPreludeSerializerPlugin strips the polyfill there).
   */
  function prelude(extra = '') {
    if (isServer) return `var __BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now(),__DEV__=${dev},__METRO_GLOBAL_PREFIX__='';` + extra;
    return (
      `var __BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now(),__DEV__=${dev},` +
      `process=globalThis.process||{},__METRO_GLOBAL_PREFIX__='';process.env=process.env||{};` +
      `process.env.NODE_ENV=process.env.NODE_ENV||${JSON.stringify(dev ? 'development' : 'production')};` +
      extra
    );
  }

  /**
   * Polyfills, transformed as scripts and wrapped with `global` exactly like Metro, with their maps (virtual
   * polyfills are listed as sources without mappings).
   */
  async function polyfillPieces(): Promise<(MapPiece & { file: string; functionMap?: FunctionMap | null })[]> {
    const out: (MapPiece & { file: string; functionMap?: FunctionMap | null })[] = [];
    const wrap = (code: string) => `(function (global) {\n${code}\n})(${SCRIPT_WRAPPER_GLOBAL});`;
    for (const f of polyfillFiles) {
      if (f === EXTERNAL_REQUIRE_POLYFILL || f === ENV_VARS_POLYFILL) {
        const code =
          f === EXTERNAL_REQUIRE_POLYFILL
            ? isWeb
              ? EXTERNAL_REQUIRE_WEB_SRC
              : EXTERNAL_REQUIRE_SRC
            : // Expo environmentVariableSerializerPlugin: EXPO_PUBLIC_* on process.env in client dev bundles (production inlines)
              dev && !isServer
              ? projectRequire('@expo/metro-config/build/serializer/environmentVariableSerializerPlugin').getEnvVarDevString()
              : '//';
        out.push({ file: f, code: wrap(code), source: f });
        continue;
      }
      const res = await transform(f, 'script', 'esm');
      // the wrapper adds one line above the transformed code
      const map = res.map ? { ...res.map, mappings: ';' + res.map.mappings } : null;
      out.push({ file: f, code: wrap(res.code ?? ''), map, functionMap: res.functionMap });
    }
    return out;
  }

  async function polyfillSources(): Promise<string[]> {
    return (await polyfillPieces()).map((p) => p.code);
  }

  return {
    projectRoot,
    platform,
    dev,
    minify,
    exp,
    routerRoot,
    baseUrl,
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
    polyfillPieces,
    stats,
    close: () => pool.close(),
  };
}

export type Project = ReturnType<typeof createProject>;
