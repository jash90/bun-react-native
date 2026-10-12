#!/usr/bin/env bun
// CLI of the Bun bundler.
//
//   export:embed  - production bundle; accepts the arguments React Native's native build scripts pass to
//                   `expo export:embed` / `react-native bundle`, so Xcode and Gradle call it instead of Metro:
//                   bun tools/bun-bundler/cli.ts export:embed --platform ios --dev false --entry-file index.js \
//                     --bundle-output main.jsbundle --assets-dest out --sourcemap-output main.map [--minify false]
//   export        - `expo export` on Bun: same flags (--platform/-p ios|android|web|all (repeatable), --output-dir,
//                   --dev, --no-minify, --no-bytecode, --source-maps, --dump-assetmap, --no-ssg) and output layout
//                   (EAS Update metadata.json, Hermes bytecode, web single/static/server) - see ./export.ts
//   start         - development server (Bun.serve) on --port (default 8081), iOS/Android/web;
//                   --web opens the app in the browser
//
// Escape hatch: RN_BUNDLER=metro runs the same command with Metro (`@expo/cli`).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { bundle } from './bundle';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  const positional: string[] = [];
  const platforms: string[] = []; // `--platform` / `-p` may repeat (expo export)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--platform' || a === '-p') && argv[i + 1] !== undefined) platforms.push(argv[i + 1]);
    if (a === '-p') {
      args.platform = argv[++i];
      continue;
    }
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
  return { args, positional, platforms };
}

function runMetro(): never {
  const req = createRequire(path.join(process.cwd(), 'package.json'));
  const expoCli = req.resolve('@expo/cli', { paths: [req.resolve('expo/package.json')] });
  const proc = Bun.spawnSync([process.execPath, expoCli, ...process.argv.slice(2)], { stdio: ['inherit', 'inherit', 'inherit'] });
  process.exit(proc.exitCode ?? 1);
}

async function runExportEmbed(args: Record<string, string>) {
  const projectRoot = path.resolve(args['project-root'] ?? process.cwd());
  const platform = (args.platform ?? 'ios') as 'ios' | 'android' | 'tvos' | 'macos';
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
    assetCatalogDest: args['asset-catalog-dest'] ? path.resolve(args['asset-catalog-dest']) : undefined,
    // The transform cache is keyed by file content, so native scripts' --reset-cache is ignored by default.
    resetCache: args['reset-cache'] === 'true' && process.env.BUN_BUNDLER_HONOR_RESET_CACHE === '1',
    log: (m) => console.log(m),
  });
  // DOM components: www.bundle/<md5>.html + web bundles next to the native assets (Expo exportEmbedAsync)
  const { persistDomComponentsForEmbed } = await import('./dom');
  const dom = await persistDomComponentsForEmbed({
    projectRoot,
    references: result.domComponents,
    dev,
    platform,
    bundleOutput,
    assetsDest: args['assets-dest'] ? path.resolve(args['assets-dest']) : undefined,
  });
  const ms = Math.round(performance.now() - started);
  console.log(`${{ ios: 'iOS', android: 'Android', tvos: 'tvOS', macos: 'macOS' }[platform]} Bundled ${ms}ms with Bun (${result.modules.length} files${dom ? `, ${dom} DOM components` : ''})`);
  console.log(`Writing bundle output to: ${bundleOutput}`);
  if (process.env.BUN_BUNDLER_TIMINGS) console.log(JSON.stringify(result.timings));
}

if (process.env.RN_BUNDLER === 'metro') runMetro();

const { args, positional, platforms } = parseArgs(process.argv.slice(2));
// real path: module paths from the resolver are real paths (e.g. /tmp -> /private/tmp on macOS)
args['project-root'] = fs.realpathSync(path.resolve(args['project-root'] ?? process.cwd()));
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
    const projectRoot = path.resolve(args['project-root'] ?? process.cwd());
    const req = createRequire(path.join(projectRoot, 'package.json'));
    // Expo CLI's own option resolution: default platforms from the Expo config, same flag semantics
    const { resolveOptionsAsync } = req('@expo/cli/build/src/export/resolveOptions');
    const flag = (name: string) => args[name] === 'true' || undefined;
    const options = await resolveOptionsAsync(projectRoot, {
      '--platform': platforms.length ? platforms : undefined,
      '--output-dir': args['output-dir'],
      '--dev': flag('dev'),
      '--no-minify': flag('no-minify'),
      '--no-bytecode': flag('no-bytecode'),
      '--no-ssg': flag('no-ssg'),
      '--dump-assetmap': flag('dump-assetmap'),
      '--source-maps': args['source-maps'] ?? args['dump-sourcemap'],
    });
    const unsupported = options.platforms.filter((p: string) => !['ios', 'android', 'web', 'tvos', 'macos'].includes(p));
    if (unsupported.length) throw new Error(`export: platform ${unsupported.join(', ')} is not supported by the Bun bundler`);
    const { exportAppAsync } = await import('./export');
    await exportAppAsync({ projectRoot, ...options, log: (m: string) => console.log(m) });
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
