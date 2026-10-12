// Which engine bundles a command. Default: Metro on the Bun runtime (1:1 with Node by construction). RN_BUNDLER=bun
// selects the Bun bundler, unless the project needs Metro - what of the project's `metro.config.js` the Bun bundler
// honours, and when it hands the command to Metro instead:
//
// The user config (`metro.config.js`, plain object export) is compared with Expo's `getDefaultConfig(projectRoot)`:
//   honoured by the Bun bundler  resolver.sourceExts, resolver.assetExts, transformer.babelTransformerPath
//                                (react-native-svg-transformer, MDX and similar Babel-transformer plugins)
//   ignored (Bun toolchain)      cacheVersion, transformer.unstable_workerThreads, transformer.minifierPath when it
//                                is tools/bun/metro-minifier.js, worker/cache/reporter settings
//   anything else                -> Metro (custom transformerPath, serializer, resolveRequest, middleware, ...):
//                                Expo CLI runs the command with Metro on the Bun runtime, which is 1:1 by
//                                construction (docs/bun-react-native/PLAN-1TO1.md section 2a)
// React Server Components and Expo Atlas (EXPO_ATLAS) also go to Metro. Functions are compared by source: getDefaultConfig creates new closures
// on every call, but with the same code. Synchronous on purpose (also used from tools/bun/expo-cli.preload.js), so a
// config exported as a function or promise goes to Metro too.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export interface BunMetroConfig {
  sourceExts: string[];
  assetExts: string[];
  /** absolute path of a custom Babel transformer, null = Expo's */
  babelTransformerPath: string | null;
}

export type MetroEngineDecision = { engine: 'bun'; config: BunMetroConfig } | { engine: 'metro'; reasons: string[] };

const HONOURED = new Set(['resolver.sourceExts', 'resolver.assetExts', 'transformer.babelTransformerPath']);
const IGNORED = new Set([
  'cacheVersion',
  'cacheStores',
  'reporter',
  'resetCache',
  'maxWorkers',
  'stickyWorkers',
  'fileMapCacheDirectory',
  'hasteMapCacheDirectory',
  'transformer.unstable_workerThreads',
]);

const cache = new Map<string, MetroEngineDecision>();

export function metroEngineDecision(projectRoot: string): MetroEngineDecision {
  const root = fs.realpathSync(projectRoot);
  let decision = cache.get(root);
  if (!decision) cache.set(root, (decision = decide(root)));
  return decision;
}

/** RN_BUNDLER=bun selects the Bun bundler; Metro on the Bun runtime is the default engine */
export function bunBundlerRequested(env: NodeJS.ProcessEnv = process.env) {
  return env.RN_BUNDLER === 'bun';
}

/** True when a command is bundled with Metro: the default, or the Bun bundler cannot take the project (says why) */
export function usesMetroEngine(projectRoot: string, command: string): boolean {
  if (!bunBundlerRequested()) return true;
  const decision = metroEngineDecision(projectRoot);
  if (decision.engine === 'bun') return false;
  console.log(`\x1b[2mBun bundler: ${command} runs on Metro (Bun runtime) - ${decision.reasons.join(', ')}\x1b[22m`);
  return true;
}

function decide(root: string): MetroEngineDecision {
  const req = createRequire(path.join(root, 'package.json'));
  const { exp } = req('@expo/config').getConfig(root, { skipSDKVersionRequirement: true });
  if (exp?.experiments?.reactServerFunctions || exp?.experiments?.reactServerComponentRoutes) {
    return { engine: 'metro', reasons: ['React Server Components'] };
  }
  // Expo Atlas (attachAtlas) wraps Metro's serializer and server: Metro collects the graphs
  if (req('@expo/cli/build/src/utils/env').env.EXPO_ATLAS) return { engine: 'metro', reasons: ['EXPO_ATLAS'] };
  const defaults = req('expo/metro-config').getDefaultConfig(root);
  const file = ['metro.config.js', 'metro.config.cjs'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!file) return { engine: 'bun', config: honoured(defaults, defaults) };
  if (['metro.config.mjs', 'metro.config.ts', 'metro.config.json'].some((f) => fs.existsSync(path.join(root, f)))) {
    return { engine: 'metro', reasons: ['more than one metro.config file'] };
  }
  const user = req(file);
  if (typeof user === 'function' || typeof user?.then === 'function') {
    return { engine: 'metro', reasons: [`${path.basename(file)} exports a function or promise`] };
  }
  const ignored = (p: string) => [...IGNORED].some((i) => p === i || p.startsWith(i + '.'));
  const bunMinifier = (p: string) => p === 'transformer.minifierPath' && /[\\/]tools[\\/]bun[\\/]metro-minifier\.js$/.test(String(user.transformer?.minifierPath));
  const reasons = differences(defaults, user).filter((p) => !HONOURED.has(p) && !ignored(p) && !bunMinifier(p));
  return reasons.length ? { engine: 'metro', reasons: reasons.map((r) => `metro.config: ${r}`) } : { engine: 'bun', config: honoured(defaults, user) };
}

function honoured(defaults: any, user: any): BunMetroConfig {
  const transformer = user.transformer?.babelTransformerPath;
  return {
    sourceExts: user.resolver?.sourceExts ?? defaults.resolver.sourceExts,
    assetExts: user.resolver?.assetExts ?? defaults.resolver.assetExts,
    babelTransformerPath: transformer && transformer !== defaults.transformer.babelTransformerPath ? transformer : null,
  };
}

/** paths (`a.b.c`) whose values differ; arrays and leaves are compared as a whole */
export function differences(a: any, b: any, at = '', out: string[] = []): string[] {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.some((x, i) => differences(x, b[i]).length)) out.push(at);
  } else if (typeof a === 'function' || typeof b === 'function' || a instanceof RegExp || b instanceof RegExp) {
    if (String(a) !== String(b)) out.push(at);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[k], b[k], at ? `${at}.${k}` : k, out);
  } else if (a !== b) {
    out.push(at);
  }
  return out;
}
