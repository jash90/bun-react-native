// The node -> Bun shim (../bin/node) first on PATH for every child process: Gradle, CocoaPods, Expo autolinking and
// RN scripts call `node` literally. With no Node.js installed `bun run` puts Bun's own `node` alias in front of
// node_modules/.bin, and that alias drops the first argument after `--eval` (oven-sh/bun#40482), which breaks
// autolinking. BUN_RN_PATH=0 leaves PATH alone.
if (process.versions.bun && process.env.BUN_RN_PATH !== '0') {
  const path = require('node:path');
  const shimDir = path.resolve(__dirname, '../bin');
  const rest = (process.env.PATH ?? '').split(path.delimiter).filter((p) => p && p !== shimDir);
  process.env.PATH = [shimDir, ...rest].join(path.delimiter);
}
