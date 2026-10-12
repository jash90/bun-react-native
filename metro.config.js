const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.versions.bun) {
  // Bun applies bunfig `preload` to forked processes but not to worker_threads, so run
  // Metro transform workers as processes to get the Node-compat shims (oven-sh/bun#44947).
  config.transformer.unstable_workerThreads = false;
}

module.exports = config;
