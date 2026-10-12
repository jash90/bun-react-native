// Expo CLI processes on Bun (`bun expo run:ios|run:android|export:embed`, started through tools/bin/node from the
// app directory, so bunfig.toml's preload applies): route Expo's `export/embed/exportEmbedAsync` to the Bun bundler.
// `expo run:ios --configuration Release` / `expo run:android --variant release` pre-bundle ("eager") through that
// module before the native build, and the build script copies that pre-bundle into the app when the options match
// (tools/bun-bundler/embed.ts): without this preload it would be Metro's bundle. RN_BUNDLER=metro keeps Metro.
if (process.versions.bun && process.env.RN_BUNDLER !== 'metro') {
  const script = process.argv[1] ?? '';
  const command = process.argv[2];
  const isExpoCli = /[\\/](\.bin[\\/]expo|expo[\\/]bin[\\/]cli|@expo[\\/]cli[\\/]build[\\/]bin[\\/]cli)$/.test(script);
  if (isExpoCli && (command === 'run:ios' || command === 'run:android' || command === 'export:embed')) {
    require('../bun-bundler/embed.ts').installBunExportEmbed(process.cwd());
  }
}
