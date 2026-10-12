// Metro on the Bun runtime for any project (also with a metro.config.js this repo does not control): installed in
// Expo CLI processes (./cli.ts, tools/bun/expo-cli.preload.js) before Metro starts, through Expo CLI's
// withMetroMultiPlatformAsync, which composes every Metro config Expo CLI uses (start, export, export:embed,
// expo-updates' createUpdatesResources):
//   - transforms on Bun worker threads that load the Node-compat shims (../bun/metro-worker-farm.js): Expo's default
//     worker_threads would run without them (bunfig preload does not reach threads; KNOWN-ISSUES #4/#5) and pick
//     other asset scales, so bundles would differ from Node's - METRO_BUN_WORKERS=0 keeps Metro's workers
//   - EXPO_PUBLIC_* / BABEL_ENV in `cacheVersion` (cache keys only): ./cli.ts keeps Metro's cache across
//     --reset-cache of native builds, and release transforms inline those values
//   - React Server Components in development: polyfill for an Expo SDK 57 bug (../bun/rsc-dev-polyfill.js,
//     KNOWN-ISSUES #17) - BUN_RN_RSC_DEV_FIX=0 turns it off
//   - Bun's native minifier instead of terser when the config keeps Metro's default (../bun/metro-minifier.js; only
//     used when Metro minifies, i.e. web exports) - METRO_BUN_MINIFIER=0 keeps terser
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

import { patchExpoCliModule } from './expo-helpers';

const RSC_POLYFILL = path.resolve(import.meta.dir, '../bun/rsc-dev-polyfill.js');
const BUN_MINIFIER = path.resolve(import.meta.dir, '../bun/metro-minifier.js');

/** cacheVersion suffix: the values release transforms inline (babel-preset-expo inline-env-vars) */
export function envCacheKey(env: NodeJS.ProcessEnv = process.env) {
  const entries = Object.keys(env)
    .filter((k) => k.startsWith('EXPO_PUBLIC_') || k === 'BABEL_ENV')
    .sort()
    .map((k) => `${k}=${env[k]}`);
  return crypto.createHash('sha1').update(entries.join('\n')).digest('hex');
}

export function installMetroOnBun(projectRoot: string) {
  if (!process.versions.bun) return;
  if (process.env.METRO_BUN_WORKERS !== '0') require('../bun/metro-worker-farm').install(projectRoot);
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const original = req('@expo/cli/build/src/start/server/metro/withMetroMultiPlatform').withMetroMultiPlatformAsync;
  if (!original || original.__bunMetro) return;
  const withMetroMultiPlatformAsync = async (root: string, options: any) => {
    const config = await original(root, options);
    const key = `bun-env:${envCacheKey()}`;
    if (!String(config.cacheVersion ?? '').includes(key)) config.cacheVersion = [config.cacheVersion, key].filter(Boolean).join(':');
    if (process.env.METRO_BUN_MINIFIER !== '0' && config.transformer?.minifierPath === 'metro-minify-terser') {
      config.transformer.minifierPath = BUN_MINIFIER;
    }
    // Metro's own worker threads would run without the shims: worker processes (they load the bunfig preload)
    if (process.env.METRO_BUN_WORKERS === '0' && config.transformer) config.transformer.unstable_workerThreads = false;
    // Expo instantiateMetro: server functions (reactServerFunctions / EXPO_UNSTABLE_SERVER_FUNCTIONS) or RSC routes
    const exp = options.exp?.experiments ?? {};
    const rsc = !!(exp.reactServerFunctions ?? process.env.EXPO_UNSTABLE_SERVER_FUNCTIONS) || !!exp.reactServerComponentRoutes;
    if (rsc && !options.isExporting && process.env.BUN_RN_RSC_DEV_FIX !== '0') {
      const getPolyfills = config.serializer.getPolyfills;
      config.serializer.getPolyfills = (ctx: any) => [...getPolyfills(ctx), RSC_POLYFILL];
    }
    return config;
  };
  Object.defineProperty(withMetroMultiPlatformAsync, '__bunMetro', { value: true });
  patchExpoCliModule(projectRoot, 'start/server/metro/withMetroMultiPlatform', { withMetroMultiPlatformAsync });
}
