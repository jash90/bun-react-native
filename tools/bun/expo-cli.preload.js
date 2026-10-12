// Expo CLI processes on Bun (`bun expo …`, started through tools/bin/node from the app directory, so bunfig.toml's
// preload applies):
//   - Metro, whenever it runs (any Expo CLI command, expo-updates' build step): transform threads with the Node-compat
//     shims, EXPO_PUBLIC_* in cache keys, RSC dev polyfill (tools/bun-bundler/metro-on-bun.ts)
//   - `expo run:ios|run:android|export:embed`: Expo's `export/embed/exportEmbedAsync` routed to the Bun bundler.
//     `expo run:ios --configuration Release` / `expo run:android --variant release` pre-bundle ("eager") through that
//     module before the native build, and the build script copies that pre-bundle into the app when the options
//     match (tools/bun-bundler/embed.ts): without this preload it would be Metro's bundle
//   - expo-updates' createUpdatesResources.js (run with the project as working directory): app.manifest assets from
//     the same Bun graph instead of a Metro server (tools/bun-bundler/updates.ts)
// RN_BUNDLER=metro keeps Metro for bundling (the Metro-on-Bun fixes still apply).
if (process.versions.bun) {
  const script = process.argv[1] ?? '';
  const command = process.argv[2];
  const isExpoCli = /[\\/](\.bin[\\/]expo|expo[\\/]bin[\\/]cli|@expo[\\/]cli[\\/]build[\\/]bin[\\/]cli)$/.test(script);
  const isUpdatesResources = /[\\/]expo-updates[\\/]utils[\\/]build[\\/]createUpdatesResources\.js$/.test(script);
  if (isExpoCli || isUpdatesResources) require('../bun-bundler/metro-on-bun.ts').installMetroOnBun(process.cwd());
  if (process.env.RN_BUNDLER !== 'metro') {
    if (isExpoCli && (command === 'run:ios' || command === 'run:android' || command === 'export:embed')) {
      require('../bun-bundler/embed.ts').installBunExportEmbed(process.cwd());
    }
    if (isUpdatesResources) require('../bun-bundler/updates.ts').installBunUpdatesResources(process.cwd());
  }
}
