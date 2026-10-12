const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.versions.bun) {
  // Bun applies bunfig `preload` to forked processes but not to worker_threads, so run
  // Metro transform workers as processes to get the Node-compat shims (oven-sh/bun#44947).
  config.transformer.unstable_workerThreads = false;
  // ...unless METRO_BUN_WORKERS=0: transform on Bun worker threads that load the shims themselves.
  if (process.env.METRO_BUN_WORKERS !== '0') {
    require('./tools/bun/metro-worker-farm').install(__dirname);
  }
  // Release transforms inline EXPO_PUBLIC_* values (babel-preset-expo inline-env-vars), but Metro's cache key does not
  // cover them - one reason native builds pass --reset-cache. With them in the key the cache survives builds
  // (tools/bun-bundler/cli.ts drops --reset-cache for export:embed); cacheVersion only feeds cache keys, not output.
  const env = Object.keys(process.env)
    .filter((k) => k.startsWith('EXPO_PUBLIC_') || k === 'BABEL_ENV')
    .sort()
    .map((k) => `${k}=${process.env[k]}`);
  config.cacheVersion = [config.cacheVersion, require('node:crypto').createHash('sha1').update(env.join('\n')).digest('hex')].join(':');
  // Minify with Bun's native minifier instead of terser (falls back to terser per module when unsafe).
  // Opt out with METRO_BUN_MINIFIER=0.
  if (process.env.METRO_BUN_MINIFIER !== '0') {
    config.transformer.minifierPath = require.resolve('./tools/bun/metro-minifier.js');
  }
}

module.exports = config;
