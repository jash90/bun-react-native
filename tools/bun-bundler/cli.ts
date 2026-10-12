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
//   start         - `expo start` (Expo CLI itself: same flags, terminal UI, Expo Go and development builds) with the
//                   Bun dev server as its bundler dev server - see ./expo-dev-server.ts
//   (export:embed lives in ./embed.ts)
//
// Escape hatch: RN_BUNDLER=metro runs the same command with Metro (`@expo/cli`).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';


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

/** `--clear`: drop the Bun bundler's transform cache (Expo: Metro's cache) */
function clearCache(projectRoot: string) {
  fs.rmSync(path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler'), { recursive: true, force: true });
  console.log('Cleared the Bun bundler cache');
}

if (process.env.RN_BUNDLER === 'metro') runMetro();

const { args, positional, platforms } = parseArgs(process.argv.slice(2));
// real path: module paths from the resolver are real paths (e.g. /tmp -> /private/tmp on macOS)
args['project-root'] = fs.realpathSync(path.resolve(args['project-root'] ?? process.cwd()));
const command = positional[0] ?? 'export:embed';

try {
  if (command === 'start') {
    // Expo CLI's own `expo start` (flags, terminal UI, Expo Go / dev clients, tunnel...) with the Bun dev server
    // registered as its bundler dev server (./expo-dev-server.ts)
    const projectRoot = fs.realpathSync(path.resolve(positional[1] ?? args['project-root'] ?? process.cwd()));
    const { installBunBundlerDevServer } = await import('./expo-dev-server');
    installBunBundlerDevServer(projectRoot);
    const req = createRequire(path.join(projectRoot, 'package.json'));
    const expoBin = req.resolve('@expo/cli'); // build/bin/cli
    process.argv = [process.argv[0], expoBin, ...process.argv.slice(process.argv.indexOf('start'))];
    req(expoBin);
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
      '--unstable-hosted-native': flag('unstable-hosted-native'),
      '--source-maps': args['source-maps'] ?? args['dump-sourcemap'],
    });
    if (args.clear === 'true') clearCache(projectRoot);
    const unsupported = options.platforms.filter((p: string) => !['ios', 'android', 'web', 'tvos', 'macos'].includes(p));
    if (unsupported.length) throw new Error(`export: platform ${unsupported.join(', ')} is not supported by the Bun bundler`);
    const { exportAppAsync } = await import('./export');
    await exportAppAsync({ projectRoot, ...options, log: (m: string) => console.log(m) });
    process.exit(0);
  } else if (command === 'export:embed' || command === 'bundle') {
    const { exportEmbedAsync } = await import('./embed');
    await exportEmbedAsync(args);
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
