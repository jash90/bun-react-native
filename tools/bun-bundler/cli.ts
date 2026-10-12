#!/usr/bin/env bun
// CLI of the Bun bundler: Expo CLI's own commands (argument parsing, help, validation, terminal UI) with the Bun
// bundler behind them - Expo's bundler-facing modules are re-pointed before Expo CLI's bin runs.
//
//   start         - `expo start`: the Bun dev server as Expo's bundler dev server (./expo-dev-server.ts)
//   export        - `expo export`: EAS Update layout, Hermes bytecode, web single/static/server (./export.ts)
//   export:embed  - `expo export:embed`, what Xcode / Gradle run for release builds (./embed.ts); `bundle` is an alias
//
// Projects with React Server Components keep Metro for these commands (Expo's RSC is bound to Metro's runtime).
// Escape hatch: RN_BUNDLER=metro runs the same command with Metro.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const index = argv.findIndex((a) => !a.startsWith('-'));
const command = index >= 0 ? argv[index] : 'export:embed';
const rest = index >= 0 ? [...argv.slice(0, index), ...argv.slice(index + 1)] : argv;
// real path: module paths from the resolver are real paths (e.g. /tmp -> /private/tmp on macOS)
const projectRoot = fs.realpathSync(process.cwd());
const req = createRequire(path.join(projectRoot, 'package.json'));

if (process.env.RN_BUNDLER !== 'metro') {
  if (command === 'start') (await import('./expo-dev-server')).installBunBundlerDevServer(projectRoot);
  else if (command === 'export') (await import('./export')).installBunExportApp(projectRoot);
  else if (command === 'export:embed' || command === 'bundle') (await import('./embed')).installBunExportEmbed(projectRoot);
  else {
    console.error(`Unknown command "${command}". Supported: start, export, export:embed (bundle)`);
    process.exit(1);
  }
}

// Metro: Xcode and Gradle always pass --reset-cache, which makes every release build transform from scratch (~8 s).
// Metro's cache keys cover file contents, transformer/Babel config and (metro.config.js) EXPO_PUBLIC_* values, so
// export:embed keeps the cache like the Bun bundler does; RN_BUNDLER_RESET_CACHE=1 honours the flag.
const args =
  process.env.RN_BUNDLER === 'metro' && (command === 'export:embed' || command === 'bundle') && process.env.RN_BUNDLER_RESET_CACHE !== '1'
    ? rest.filter((a) => a !== '--reset-cache')
    : rest;

// Expo CLI's bin, as if run as `expo <command> ...`
const expoBin = req.resolve('@expo/cli'); // build/bin/cli
process.argv = [process.argv[0], expoBin, command === 'bundle' ? 'export:embed' : command, ...args];
req(expoBin);
