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
  customTransformOptions: Record<string, string>;
}

export interface TransformResponse {
  id: number;
  code?: string;
  map?: any;
  error?: string;
}

export const REQUIRE_CONTEXT_PREFIX = '\0require-context:';

let babel: {
  transformer: any;
  generate: any;
  traverse: any;
  t: any;
} | null = null;

function load(projectRoot: string) {
  if (babel) return babel;
  const req = createRequire(projectRoot + '/package.json');
  babel = {
    transformer: req('@expo/metro-config/build/babel-transformer'),
    generate: req('@babel/generator').default,
    traverse: req('@babel/traverse').default,
    t: req('@babel/types'),
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
  const out = b.generate(ast, { sourceMaps: true, sourceFileName: req.filename, filename: req.filename, comments: false }, req.src);
  return { id: req.id, code: out.code, map: out.map };
}

self.onmessage = (event: MessageEvent<TransformRequest>) => {
  const req = event.data;
  let res: TransformResponse;
  try {
    res = transform(req);
  } catch (e: any) {
    res = { id: req.id, error: `${req.filename}: ${e?.stack ?? e}` };
  }
  postMessage(res);
};
