const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.versions.bun) {
  // Bun applies bunfig `preload` to forked processes but not to worker_threads, so run
  // Metro transform workers as processes to get the Node-compat shims (oven-sh/bun#44947).
  config.transformer.unstable_workerThreads = false;
  // Transform threads with the shims, EXPO_PUBLIC_* in cache keys: installed for every Expo CLI process on Bun by
  // tools/bun/expo-cli.preload.js (tools/bun-bundler/metro-on-bun.ts); this switch matters for METRO_BUN_WORKERS=0.
  // Minify with Bun's native minifier instead of terser (falls back to terser per module when unsafe).
  // Opt out with METRO_BUN_MINIFIER=0.
  if (process.env.METRO_BUN_MINIFIER !== '0') {
    config.transformer.minifierPath = require.resolve('./tools/bun/metro-minifier.js');
  }
}

module.exports = config;
