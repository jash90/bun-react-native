// Expo CLI processes on Bun (`bun expo …`, and the Xcode/Gradle bundle steps and expo-updates' build step, which run
// from the app directory, so bunfig.toml's preload applies):
//   - Metro, whenever it runs: transform threads with the Node-compat shims, EXPO_PUBLIC_* in cache keys, Bun's
//     minifier, RSC dev polyfill (tools/bun-bundler/metro-on-bun.ts) - the default engine, byte-identical to Node
//   - `export:embed` (Xcode/Gradle release bundles, `expo run:* --configuration Release|--variant release`) keeps
//     Metro's cache across the `--reset-cache` native builds always pass (cache keys cover file contents, transformer
//     and Babel config, EXPO_PUBLIC_*); RN_BUNDLER_RESET_CACHE=1 honours the flag
//   - RN_BUNDLER=bun: Expo's bundler-facing modules point at the Bun bundler - `start` / `run:*` dev server
//     (tools/bun-bundler/expo-dev-server.ts), `export` (export.ts), `export:embed` and the "eager" Release pre-bundle
//     of `run:*` (embed.ts), expo-updates' createUpdatesResources.js (updates.ts). Projects the Bun bundler cannot
//     take (React Server Components, unsupported metro.config.js) stay on Metro (metro-config-support.ts).
if (process.versions.bun) {
  const script = process.argv[1] ?? '';
  const command = process.argv[2];
  const isExpoCli = /[\\/](\.bin[\\/]expo|expo[\\/]bin[\\/]cli|@expo[\\/]cli[\\/]build[\\/]bin[\\/]cli)$/.test(script);
  const isUpdatesResources = /[\\/]expo-updates[\\/]utils[\\/]build[\\/]createUpdatesResources\.js$/.test(script);
  if (isExpoCli || isUpdatesResources) {
    const root = process.cwd();
    require('../bun-bundler/metro-on-bun.ts').installMetroOnBun(root);
    const engine = require('../bun-bundler/metro-config-support.ts');
    const bun = engine.bunBundlerRequested() && !engine.usesMetroEngine(root, isExpoCli ? `expo ${command}` : 'expo-updates resources');
    if (bun && isUpdatesResources) require('../bun-bundler/updates.ts').installBunUpdatesResources(root);
    if (bun && isExpoCli) {
      if (command === 'start' || command === 'run:ios' || command === 'run:android') {
        require('../bun-bundler/expo-dev-server.ts').installBunBundlerDevServer(root);
      }
      if (command === 'export') require('../bun-bundler/export.ts').installBunExportApp(root);
      if (command === 'export:embed' || command === 'run:ios' || command === 'run:android') {
        require('../bun-bundler/embed.ts').installBunExportEmbed(root);
      }
    }
    // Metro export: the web render function before the client bundle, so module IDs do not depend on a race
    if (!bun && isExpoCli && command === 'export') require('./expo-export-order').install(root);
    if (!bun && isExpoCli && command === 'export:embed' && process.env.RN_BUNDLER_RESET_CACHE !== '1') {
      process.argv = process.argv.filter((a, i) => i < 2 || a !== '--reset-cache');
    }
  }
}
