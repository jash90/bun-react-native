#!/usr/bin/env bun
// Expo CLI's bundling commands with bun-react-native's engines behind them (argument parsing, help, validation,
// terminal UI stay Expo's). Metro on the Bun runtime is the default; RN_BUNDLER=bun points Expo's bundler-facing
// modules at the Bun bundler before Expo CLI's bin runs. The bunfig preload (tools/bun/expo-cli.preload.js) does the
// same for plain `expo start|export|export:embed|run:*`; this entry point is for running it without that preload.
//
//   start         - `expo start`: the Bun dev server as Expo's bundler dev server (./expo-dev-server.ts)
//   export        - `expo export`: EAS Update layout, Hermes bytecode, web single/static/server (./export.ts)
//   export:embed  - `expo export:embed`, what Xcode / Gradle run for release builds (./embed.ts); `bundle` is an alias
//
// With RN_BUNDLER=bun, projects with React Server Components or metro.config.js customizations the Bun bundler does
// not honour keep Metro for these commands, still on the Bun runtime (./metro-config-support.ts).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { bunBundlerRequested, metroEngineDecision } from './metro-config-support';

const argv = process.argv.slice(2);
const index = argv.findIndex((a) => !a.startsWith('-'));
const command = index >= 0 ? argv[index] : 'export:embed';
const rest = index >= 0 ? [...argv.slice(0, index), ...argv.slice(index + 1)] : argv;
// real path: module paths from the resolver are real paths (e.g. /tmp -> /private/tmp on macOS)
const projectRoot = fs.realpathSync(process.cwd());
const req = createRequire(path.join(projectRoot, 'package.json'));

// Metro on Bun: shims in transform threads, EXPO_PUBLIC_* in cache keys, RSC dev polyfill (./metro-on-bun.ts) -
// first, before any Expo CLI module is loaded (they keep references to the modules it patches)
(await import('./metro-on-bun')).installMetroOnBun(projectRoot);

if (!['start', 'export', 'export:embed', 'bundle'].includes(command)) {
  console.error(`Unknown command "${command}". Supported: start, export, export:embed (bundle)`);
  process.exit(1);
}
if (bunBundlerRequested()) {
  if (command === 'start') (await import('./expo-dev-server')).installBunBundlerDevServer(projectRoot);
  else if (command === 'export') (await import('./export')).installBunExportApp(projectRoot);
  else (await import('./embed')).installBunExportEmbed(projectRoot);
}

// Metro: Xcode and Gradle always pass --reset-cache, which makes every release build transform from scratch (~8 s).
// Metro's cache keys cover file contents, transformer/Babel config and (metro.config.js) EXPO_PUBLIC_* values, so
// export:embed keeps the cache like the Bun bundler does (also when the project is switched to Metro automatically);
// RN_BUNDLER_RESET_CACHE=1 honours the flag.
const onMetro = !bunBundlerRequested() || metroEngineDecision(projectRoot).engine === 'metro';
const args =
  onMetro && (command === 'export:embed' || command === 'bundle') && process.env.RN_BUNDLER_RESET_CACHE !== '1'
    ? rest.filter((a) => a !== '--reset-cache')
    : rest;


// Expo CLI's bin, as if run as `expo <command> ...`
const expoBin = req.resolve('@expo/cli'); // build/bin/cli
process.argv = [process.argv[0], expoBin, command === 'bundle' ? 'export:embed' : command, ...args];
req(expoBin);
