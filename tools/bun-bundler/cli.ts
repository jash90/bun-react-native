#!/usr/bin/env bun
// CLI of the Bun bundler.
//
//   export:embed  - production bundle; accepts the arguments React Native's native build scripts pass to
//                   `expo export:embed` / `react-native bundle`, so Xcode and Gradle call it instead of Metro:
//                   bun tools/bun-bundler/cli.ts export:embed --platform ios --dev false --entry-file index.js \
//                     --bundle-output main.jsbundle --assets-dest out --sourcemap-output main.map [--minify false]
//   export        - web static export (--platform web --output-dir dist), Expo Router static rendering
//   start         - development server (Bun.serve) on --port (default 8081), iOS/Android/web;
//                   --web opens the app in the browser
//
// Escape hatch: RN_BUNDLER=metro runs the same command with Metro (`@expo/cli`).
import path from 'node:path';
import { createRequire } from 'node:module';

import { bundle } from './bundle';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[a.slice(2)] = next;
        i++;
      } else {
        args[a.slice(2)] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { args, positional };
}

function runMetro(): never {
  const req = createRequire(path.join(process.cwd(), 'package.json'));
  const expoCli = req.resolve('@expo/cli', { paths: [req.resolve('expo/package.json')] });
  const proc = Bun.spawnSync([process.execPath, expoCli, ...process.argv.slice(2)], { stdio: ['inherit', 'inherit', 'inherit'] });
  process.exit(proc.exitCode ?? 1);
}

async function runExportEmbed(args: Record<string, string>) {
  const projectRoot = path.resolve(args['project-root'] ?? process.cwd());
  const platform = (args.platform ?? 'ios') as 'ios' | 'android';
  const dev = args.dev === 'true';
  // RN's scripts pass --minify false for Hermes release builds; otherwise minify when !dev (Metro default).
  const minify = args.minify !== undefined ? args.minify === 'true' : !dev;
  const bundleOutput = path.resolve(args['bundle-output'] ?? `${platform}.bundle.js`);
  const started = performance.now();
  const result = await bundle({
    projectRoot,
    entryFile: args['entry-file'] ?? 'index.js',
    platform,
    dev,
    minify,
    bundleOutput,
    sourcemapOutput: args['sourcemap-output'] ? path.resolve(args['sourcemap-output']) : undefined,
    assetsDest: args['assets-dest'] ? path.resolve(args['assets-dest']) : undefined,
    // The transform cache is keyed by file content, so native scripts' --reset-cache is ignored by default.
    resetCache: args['reset-cache'] === 'true' && process.env.BUN_BUNDLER_HONOR_RESET_CACHE === '1',
    log: (m) => console.log(m),
  });
  const ms = Math.round(performance.now() - started);
  console.log(`${platform === 'ios' ? 'iOS' : 'Android'} Bundled ${ms}ms with Bun (${result.modules.length} files)`);
  console.log(`Writing bundle output to: ${bundleOutput}`);
  if (process.env.BUN_BUNDLER_TIMINGS) console.log(JSON.stringify(result.timings));
}

if (process.env.RN_BUNDLER === 'metro') runMetro();

const { args, positional } = parseArgs(process.argv.slice(2));
const command = positional[0] ?? 'export:embed';

try {
  if (command === 'start') {
    const { startDevServer } = await import('./dev-server');
    const server = await startDevServer({ projectRoot: path.resolve(args['project-root'] ?? process.cwd()), port: Number(args.port ?? 8081) });
    if (args.web === 'true') {
      const url = `http://localhost:${server.port}`;
      Bun.spawn(process.platform === 'darwin' ? ['open', url] : ['xdg-open', url], { stdio: ['ignore', 'ignore', 'ignore'] });
    }
  } else if (command === 'export') {
    if ((args.platform ?? 'web') !== 'web') throw new Error('export: only --platform web (native: export:embed)');
    const { exportWeb } = await import('./web');
    await exportWeb({
      projectRoot: path.resolve(args['project-root'] ?? process.cwd()),
      outputDir: path.resolve(args['output-dir'] ?? 'dist'),
      minify: args['no-minify'] !== 'true',
      log: (m) => console.log(m),
    });
    process.exit(0);
  } else if (command === 'export:embed' || command === 'bundle') {
    await runExportEmbed(args);
    // Terminated Bun Workers / Bun.build can keep the event loop alive; native build scripts wait for exit.
    process.exit(0);
  } else {
    console.error(`Unknown command "${command}". Supported: export:embed, bundle, export, start`);
    process.exit(1);
  }
} catch (e: any) {
  console.error(e?.stack ?? e);
  process.exit(1);
}
