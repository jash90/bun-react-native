// Babel transform worker (Bun Worker thread) for the Bun bundler.
//
// Runs exactly the Babel transform Metro runs for an Expo app (`@expo/metro-config` babel-transformer
// with `expo/internal/babel-preset` and the same `caller`), keeps ES module syntax
// (`experimentalImportSupport: true` => `supportsStaticESM`), rewrites Metro's `require.context(...)`
// into an import of a virtual module the bundler generates, and returns code + source map.
import path from 'node:path';
import { createRequire } from 'node:module';

declare const self: Worker;

export interface TransformRequest {
  id: number;
  filename: string;
  src: string;
  projectRoot: string;
  platform: string;
  dev: boolean;
  /** export minification (Expo strips server-only files to '' instead of a notice when minifying) */
  minify?: boolean;
  type: 'module' | 'script';
  /** 'esm' (default): ES modules for Bun.build; 'metro': CommonJS module body for the Metro-format dev runtime. */
  format?: 'esm' | 'metro';
  customTransformOptions: Record<string, string>;
  /** babel-preset-expo `unstable_transformProfile` (hermes-stable | hermes-canary | default) */
  transformProfile?: string;
  /** metro.config.js `transformer.babelTransformerPath` when it is not Expo's (metro-config-support.ts) */
  babelTransformerPath?: string | null;
}

export interface TransformResponse {
  id: number;
  code?: string;
  map?: any;
  /** format 'metro': module specifiers, in `_dependencyMap` order */
  deps?: string[];
  /** format 'metro': specifiers that came from ES `import`/`export from`/`import()` (resolver condition `import`) */
  esmDeps?: string[];
  /** format 'metro': indices into `deps` loaded with `import()` (lazy bundles in development, like Metro) */
  asyncDeps?: number[];
  /** the module exports an expo-router `loader` (babel-preset-expo server-data-loaders metadata) */
  loaderReference?: boolean;
  /** file URL of a `"use dom"` component (native proxy; the DOM bundle is exported separately) */
  domComponentReference?: string;
  /** specifiers only required inside try blocks / `import()` with a rejection handler (Metro optional deps) */
  optionalDeps?: string[];
  /** Metro function map (functionMapBabelPlugin): `x_facebook_sources` of exported source maps */
  functionMap?: { names: string[]; mappings: string } | null;
  error?: string;
}

export const REQUIRE_CONTEXT_PREFIX = '\0require-context:';

let babel: {
  babelRuntimeVersion: string | undefined;
  parseEnvFile: (src: string, isClient: boolean) => Record<string, string>;
  transformer: any;
  functionMapBabelPlugin: any;
  generate: any;
  traverse: any;
  t: any;
  core: any;
  commonjs: any;
} | null = null;

function load(projectRoot: string) {
  if (babel) return babel;
  const req = createRequire(projectRoot + '/package.json');
  let babelRuntimeVersion: string | undefined;
  try {
    babelRuntimeVersion = req('@babel/runtime/package.json').version;
  } catch {}
  babel = {
    babelRuntimeVersion,
    parseEnvFile: req('@expo/metro-config/build/transform-worker/dot-env-development').parseEnvFile,
    transformer: req('@expo/metro-config/build/babel-transformer'),
    functionMapBabelPlugin: req('@expo/metro/metro-source-map').functionMapBabelPlugin,
    generate: req('@babel/generator').default,
    traverse: req('@babel/traverse').default,
    t: req('@babel/types'),
    core: req('@babel/core'),
    commonjs: req('@babel/plugin-transform-modules-commonjs'),
  };
  return babel;
}

function rewriteRequireContext(ast: any, b: NonNullable<typeof babel>) {
  b.traverse(ast, {
    CallExpression(p: any) {
      const callee = p.node.callee;
      if (
        !b.t.isMemberExpression(callee) ||
        !b.t.isIdentifier(callee.object, { name: 'require' }) ||
        !b.t.isIdentifier(callee.property, { name: 'context' })
      ) {
        return;
      }
      const [dirArg, recursiveArg, filterArg, modeArg] = p.node.arguments;
      if (!b.t.isStringLiteral(dirArg)) throw new Error('require.context: first argument must be a string literal');
      const spec = {
        dir: dirArg.value,
        recursive: recursiveArg ? b.t.isBooleanLiteral(recursiveArg) && recursiveArg.value : true,
        filter: filterArg && b.t.isRegExpLiteral(filterArg) ? { pattern: filterArg.pattern, flags: filterArg.flags } : { pattern: '^\\.\\/.*$', flags: '' },
        mode: modeArg && b.t.isStringLiteral(modeArg) ? modeArg.value : 'sync',
      };
      p.replaceWith(b.t.callExpression(b.t.identifier('require'), [b.t.stringLiteral(REQUIRE_CONTEXT_PREFIX + JSON.stringify(spec))]));
    },
  });
}

// ---- metro collectDependencies isOptionalDependency (allowOptionalDependencies: true in Expo's Metro config)
const isNonNullishCallbackArg = (n: any) => n != null && n.type !== 'NullLiteral' && !(n.type === 'Identifier' && n.name === 'undefined');

function isInPromiseChainWithRejectionHandler(path: any): boolean {
  let current = path;
  while (current.parentPath != null) {
    const member = current.parentPath;
    if (member.node.type !== 'MemberExpression' || member.node.object !== current.node || member.node.computed || member.node.property.type !== 'Identifier' || member.parentPath == null) return false;
    const call = member.parentPath;
    if (call.node.type !== 'CallExpression' || call.node.callee !== member.node) return false;
    const name = member.node.property.name;
    const args = call.node.arguments;
    if (name === 'catch' && args.length >= 1 && isNonNullishCallbackArg(args[0])) return true;
    if (name === 'then' && args.length >= 2 && isNonNullishCallbackArg(args[1])) return true;
    current = call;
  }
  return false;
}

/** a dependency is optional inside a single-level try block, or an import() with a rejection handler */
function isOptionalDependency(path: any): boolean {
  if (isInPromiseChainWithRejectionHandler(path)) return true;
  let count = 0;
  let p = path;
  while (p && count < 3) {
    if (p.isStatement()) {
      if (p.node.type === 'BlockStatement') return p.parentPath != null && p.parentPath.node.type === 'TryStatement' && p.key === 'block';
      count += 1;
    }
    p = p.parentPath;
  }
  return false;
}

/** specifiers whose every require/import() is optional */
function optionalSpecifiers(ast: any, b: NonNullable<typeof babel>, requireNames: string[]): string[] {
  const optional = new Set<string>();
  const required = new Set<string>();
  b.traverse(ast, {
    CallExpression(p: any) {
      const { callee, arguments: args } = p.node;
      const isRequire = b.t.isIdentifier(callee) && requireNames.includes(callee.name) && !p.scope.hasBinding(callee.name);
      if (!(isRequire || b.t.isImport(callee)) || !b.t.isStringLiteral(args[0])) return;
      (isOptionalDependency(p) ? optional : required).add(args[0].value);
    },
  });
  return [...optional].filter((s) => !required.has(s));
}

/** Placeholder for `import("x")` between the CommonJS pass and dependency collection (format 'metro'). */
const ASYNC_IMPORT = '__bunRnAsyncImport';
/** Expo's `transformer.asyncRequireModulePath` (@expo/metro-config) */
const ASYNC_REQUIRE_MODULE = 'expo/internal/async-require-module';

/**
 * Babel plugin: `require("x")` -> `require(_dependencyMap[i], "x")` (Metro module runtime) and collect the
 * specifiers. Runs after ESM -> CommonJS, so imports and re-exports are `require` calls. `import("x")` (kept as a
 * placeholder through the CommonJS pass) becomes Metro's async require:
 * `require(_dependencyMap[a], "expo/internal/async-require-module")(_dependencyMap[i], _dependencyMap.paths, "x")`.
 */
function collectDependencies(deps: string[], asyncDeps: number[]) {
  return ({ types: t }: any) => ({
    visitor: {
      CallExpression(p: any) {
        const { callee, arguments: args } = p.node;
        if (t.isIdentifier(callee, { name: ASYNC_IMPORT }) && t.isStringLiteral(args[0])) {
          const spec = args[0].value;
          const i = deps.push(spec) - 1;
          asyncDeps.push(i);
          let a = deps.indexOf(ASYNC_REQUIRE_MODULE);
          if (a === -1) a = deps.push(ASYNC_REQUIRE_MODULE) - 1;
          const dep = (n: number) => t.memberExpression(t.identifier('_dependencyMap'), t.numericLiteral(n), true);
          p.replaceWith(
            t.callExpression(t.callExpression(t.identifier('require'), [dep(a), t.stringLiteral(ASYNC_REQUIRE_MODULE)]), [
              dep(i),
              t.memberExpression(t.identifier('_dependencyMap'), t.identifier('paths')),
              t.stringLiteral(spec),
            ])
          );
          p.skip();
          return;
        }
        if (!t.isIdentifier(callee, { name: 'require' }) || p.scope.hasBinding('require')) return;
        if (args.length < 1 || !t.isStringLiteral(args[0])) return;
        if (t.isMemberExpression(args[0])) return;
        const spec = args[0].value;
        let index = deps.indexOf(spec);
        if (index === -1) index = deps.push(spec) - 1;
        p.node.arguments = [
          t.memberExpression(t.identifier('_dependencyMap'), t.numericLiteral(index), true),
          t.stringLiteral(spec),
        ];
        p.skip();
      },
    },
  });
}

/**
 * The source rewrites @expo/metro-config's transform-worker applies before Babel (transform-worker.js `transform`):
 * DOM component entry, server-only files stripped from client bundles, `.env` files, the `expo/virtual/env` and
 * `expo/virtual/streams` modules. Returns the source to transform.
 */
function expoPreTransform(req: TransformRequest, b: NonNullable<typeof babel>): string {
  const posix = req.filename.split('\\').join('/');
  const rel = posix.startsWith(req.projectRoot + '/') ? posix.slice(req.projectRoot.length + 1) : posix;
  const opts = req.customTransformOptions;
  const environment = opts.environment;
  const isClient = environment !== 'node' && environment !== 'react-server';
  if (typeof opts.dom === 'string' && posix.match(/expo\/dom\/entry\.js/)) {
    return `require('expo/dom/internal').registerDOMComponent(require(${JSON.stringify(decodeURI(opts.dom))}).default);`;
  }
  if (
    isClient &&
    (rel.match(new RegExp(`^app/\\+html(\\.${req.platform})?\\.([tj]sx?|[cm]js)?$`)) ||
      rel.match(/\+api(\.(native|ios|android|web))?\.[tj]sx?$/) ||
      rel.match(/\+middleware\.[tj]sx?$/))
  ) {
    return req.minify ? '' : '"> The server-only file was removed from the client JS bundle by Expo CLI."';
  }
  if (rel.match(/(^|\/)\.env(\.(local|(development|production)(\.local)?))?$/)) {
    return `export default ${JSON.stringify(b.parseEnvFile(req.src, isClient))};`;
  }
  if (!isClient && posix.match(/\/expo\/virtual\/streams\.js$/)) return '';
  if (isClient && posix.match(/\/expo\/virtual\/env\.js$/)) {
    if (req.dev) {
      const relativePath = path.relative(path.dirname(req.filename), req.projectRoot).split(path.sep).join('/');
      return `const dotEnvModules = require.context(${JSON.stringify(relativePath)},false,/^\\.\\/\\.env/);

    export const env = !dotEnvModules.keys().length ? process.env : { ...process.env, ...['.env', '.env.development', '.env.local', '.env.development.local'].reduce((acc, file) => {
      return { ...acc, ...(dotEnvModules(file)?.default ?? {}) };
    }, {}) };`;
    }
    return `
        export const env = new Proxy({}, {
          get(target, key) {
            throw new Error(\`Attempting to access internal environment variable "\${key}" is not supported in production bundles. Environment variables should be inlined in production by Babel.\`);
          },
       });`;
  }
  return req.src;
}

async function transform(req: TransformRequest): Promise<TransformResponse> {
  const b = load(req.projectRoot);
  // the options Metro passes to @expo/metro-config's babel-transformer (getTransformOptions of Expo's Metro config)
  const options = {
    dev: req.dev,
    hot: req.dev,
    minify: !!req.minify,
    platform: req.platform,
    projectRoot: req.projectRoot,
    publicPath: '/assets',
    type: req.type,
    experimentalImportSupport: true,
    inlineRequires: false,
    unstable_transformProfile: req.transformProfile ?? (req.platform === 'web' ? 'default' : 'hermes-stable'),
    enableBabelRCLookup: undefined,
    enableBabelRuntime: b.babelRuntimeVersion,
    globalPrefix: '',
    customTransformOptions: req.customTransformOptions,
  };
  const src = expoPreTransform(req, b);
  // like Expo's transform worker: functionMapBabelPlugin fills metadata.metro.functionMap; a custom Babel transformer
  // (react-native-svg-transformer, ...) gets the same arguments and may be async (Metro awaits it)
  const transformer = req.babelTransformerPath ? require(req.babelTransformerPath) : b.transformer;
  const { ast, metadata } = await transformer.transform({ filename: req.filename, src, options, plugins: [b.functionMapBabelPlugin] });
  if (!ast) return { id: req.id, code: '' };
  const functionMap = metadata?.metro?.functionMap ?? null;
  const loaderReference = metadata?.loaderReference ? true : undefined;
  const domComponentReference: string | undefined = metadata?.expoDomComponentReference ?? undefined;
  if (src.includes('require.context')) rewriteRequireContext(ast, b);
  if (req.format === 'metro') {
    // ES module specifiers, recorded before they become `require` calls (exports condition `import` vs `require`)
    const esmDeps = new Set<string>();
    b.traverse(ast, {
      ImportDeclaration(p: any) {
        esmDeps.add(p.node.source.value);
      },
      ExportNamedDeclaration(p: any) {
        if (p.node.source) esmDeps.add(p.node.source.value);
      },
      ExportAllDeclaration(p: any) {
        esmDeps.add(p.node.source.value);
      },
      CallExpression(p: any) {
        if (b.t.isImport(p.node.callee) && b.t.isStringLiteral(p.node.arguments[0])) esmDeps.add(p.node.arguments[0].value);
      },
    });
    // `import("x")` -> placeholder, so the CommonJS pass keeps it asynchronous (Metro: asyncType 'async')
    b.traverse(ast, {
      CallExpression(p: any) {
        if (b.t.isImport(p.node.callee) && p.node.arguments.length === 1 && b.t.isStringLiteral(p.node.arguments[0])) {
          p.node.callee = b.t.identifier(ASYNC_IMPORT);
        }
      },
    });
    const base = { filename: req.filename, babelrc: false, configFile: false, cloneInputAst: false };
    // pass 1: ES modules -> CommonJS (imports become `require` calls at Program exit)
    const cjs = b.core.transformFromAstSync(ast, src, { ...base, ast: true, code: false, plugins: [b.commonjs] });
    // pass 2: `require("x")` -> `require(_dependencyMap[i], "x")`, keeping the original locations for the map
    const deps: string[] = [];
    const asyncDeps: number[] = [];
    const optionalDeps = optionalSpecifiers(cjs.ast, b, ['require', ASYNC_IMPORT]);
    const out = b.core.transformFromAstSync(cjs.ast, src, {
      ...base,
      sourceMaps: true,
      sourceFileName: req.filename,
      comments: false,
      plugins: [collectDependencies(deps, asyncDeps)],
    });
    return { id: req.id, code: out.code, map: out.map, deps, esmDeps: deps.filter((d) => esmDeps.has(d)), asyncDeps, loaderReference, domComponentReference, optionalDeps, functionMap };
  }
  const optionalDeps = optionalSpecifiers(ast, b, ['require']);
  const out = b.generate(ast, { sourceMaps: true, sourceFileName: req.filename, filename: req.filename, comments: false }, src);
  return { id: req.id, code: out.code, map: out.map, loaderReference, domComponentReference, optionalDeps, functionMap };
}

// Only inside the Worker: modules import constants from this file, and a message listener on the main thread would
// keep the bundler's process alive after its work is done.
if (!Bun.isMainThread) self.onmessage = async (event: MessageEvent<TransformRequest>) => {
  const req = event.data;
  let res: TransformResponse;
  try {
    res = await transform(req);
  } catch (e: any) {
    // Babel's message already carries the code frame; its parser stack is noise in the app's error overlay.
    const message = String(e?.message ?? e);
    res = { id: req.id, error: message.startsWith(req.filename) ? message : `${req.filename}: ${message}` };
  }
  postMessage(res);
};
