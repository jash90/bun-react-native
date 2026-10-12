// Babel transform worker (Bun Worker thread) for the Bun bundler.
//
// Runs exactly the Babel transform Metro runs for an Expo app (`@expo/metro-config` babel-transformer
// with `expo/internal/babel-preset` and the same `caller`), keeps ES module syntax
// (`experimentalImportSupport: true` => `supportsStaticESM`), rewrites Metro's `require.context(...)`
// into an import of a virtual module the bundler generates, and returns code + source map.
import { createRequire } from 'node:module';

declare const self: Worker;

export interface TransformRequest {
  id: number;
  filename: string;
  src: string;
  projectRoot: string;
  platform: string;
  dev: boolean;
  type: 'module' | 'script';
  /** 'esm' (default): ES modules for Bun.build; 'metro': CommonJS module body for the Metro-format dev runtime. */
  format?: 'esm' | 'metro';
  customTransformOptions: Record<string, string>;
}

export interface TransformResponse {
  id: number;
  code?: string;
  map?: any;
  /** format 'metro': module specifiers, in `_dependencyMap` order */
  deps?: string[];
  /** format 'metro': specifiers that came from ES `import`/`export from`/`import()` (resolver condition `import`) */
  esmDeps?: string[];
  error?: string;
}

export const REQUIRE_CONTEXT_PREFIX = '\0require-context:';

let babel: {
  transformer: any;
  generate: any;
  traverse: any;
  t: any;
  core: any;
  commonjs: any;
} | null = null;

function load(projectRoot: string) {
  if (babel) return babel;
  const req = createRequire(projectRoot + '/package.json');
  babel = {
    transformer: req('@expo/metro-config/build/babel-transformer'),
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

/**
 * Babel plugin: `require("x")` -> `require(_dependencyMap[i], "x")` (Metro module runtime) and collect the
 * specifiers. Runs after ESM -> CommonJS, so imports, re-exports and `import()` are all `require` calls.
 */
function collectDependencies(deps: string[]) {
  return ({ types: t }: any) => ({
    visitor: {
      CallExpression(p: any) {
        const { callee, arguments: args } = p.node;
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

function transform(req: TransformRequest): TransformResponse {
  const b = load(req.projectRoot);
  const options = {
    dev: req.dev,
    hot: false,
    minify: false,
    platform: req.platform,
    projectRoot: req.projectRoot,
    publicPath: '/assets',
    type: req.type,
    experimentalImportSupport: true,
    inlineRequires: false,
    unstable_transformProfile: 'hermes-stable',
    enableBabelRCLookup: true,
    globalPrefix: '',
    customTransformOptions: req.customTransformOptions,
  };
  const { ast } = b.transformer.transform({ filename: req.filename, src: req.src, options, plugins: [] });
  if (!ast) return { id: req.id, code: '' };
  if (req.src.includes('require.context')) rewriteRequireContext(ast, b);
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
    const base = { filename: req.filename, babelrc: false, configFile: false, cloneInputAst: false };
    // pass 1: ES modules -> CommonJS (imports become `require` calls at Program exit)
    const cjs = b.core.transformFromAstSync(ast, req.src, { ...base, ast: true, code: false, plugins: [b.commonjs] });
    // pass 2: `require("x")` -> `require(_dependencyMap[i], "x")`, keeping the original locations for the map
    const deps: string[] = [];
    const out = b.core.transformFromAstSync(cjs.ast, req.src, {
      ...base,
      sourceMaps: true,
      sourceFileName: req.filename,
      comments: false,
      plugins: [collectDependencies(deps)],
    });
    return { id: req.id, code: out.code, map: out.map, deps, esmDeps: deps.filter((d) => esmDeps.has(d)) };
  }
  const out = b.generate(ast, { sourceMaps: true, sourceFileName: req.filename, filename: req.filename, comments: false }, req.src);
  return { id: req.id, code: out.code, map: out.map };
}

self.onmessage = (event: MessageEvent<TransformRequest>) => {
  const req = event.data;
  let res: TransformResponse;
  try {
    res = transform(req);
  } catch (e: any) {
    // Babel's message already carries the code frame; its parser stack is noise in the app's error overlay.
    const message = String(e?.message ?? e);
    res = { id: req.id, error: message.startsWith(req.filename) ? message : `${req.filename}: ${message}` };
  }
  postMessage(res);
};
