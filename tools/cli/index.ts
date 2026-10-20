#!/usr/bin/env bun
// bun-react-native CLI:
//   init                    wire the package into the app in the current directory (bunfig.toml, config plugin, EAS)
//   doctor                  check the setup and show which engine bundles the app
//   compare <a> <b>         compare two `expo export` output directories (Metro vs RN_BUNDLER=bun)
//   eas-build-post-install  EAS Build hook: the node -> Bun shim first on PATH for the native build steps
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { doctor } from './doctor';
import { init } from './init';
import { PACKAGE_ROOT } from './project';

const [command, ...args] = process.argv.slice(2);
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const mark = { true: '\x1b[32m✓\x1b[39m', false: '\x1b[31m✗\x1b[39m', warn: '\x1b[33m!\x1b[39m' } as const;

function runDoctor() {
  const checks = doctor(process.cwd());
  for (const c of checks) console.log(`${mark[String(c.ok) as keyof typeof mark]} ${c.title}${c.detail ? `\n  ${dim(c.detail)}` : ''}`);
  return checks.some((c) => c.ok === false) ? 1 : 0;
}

switch (command) {
  case 'init': {
    const { changed, todo } = init(process.cwd());
    console.log(changed.length ? `updated: ${changed.join(', ')}` : 'nothing to change');
    for (const t of todo) console.log(`${mark.warn} ${t}`);
    console.log('\nNext: `bun install`, then the usual commands - `bun expo start`, `bun expo run:ios|run:android`, `bun expo export`.');
    console.log(dim('Metro runs on Bun by default; RN_BUNDLER=bun selects the Bun bundler. Checking the setup:\n'));
    // a new Bun process in the app directory loads the bunfig.toml preload init just wrote
    const r = spawnSync(process.execPath, [import.meta.path, 'doctor'], { stdio: 'inherit', cwd: process.cwd() });
    process.exit(r.status ?? 1);
  }
  case 'doctor':
    process.exit(runDoctor());
  case 'compare': {
    const r = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, 'tools/bun-bundler/compare-exports.ts'), ...args], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  case 'eas-build-post-install': {
    // EAS runs this after installing dependencies; `set-env` (an EAS Build helper) changes PATH for later build phases
    const shimDir = path.join(PACKAGE_ROOT, 'tools', 'bin');
    const set = spawnSync('set-env', ['PATH', `${shimDir}:${process.env.PATH}`], { stdio: 'inherit' });
    if (set.error) console.warn(`set-env is not available (not on EAS Build?) - put ${shimDir} first on PATH yourself`);
    const probe = spawnSync(path.join(shimDir, 'node'), ['-p', 'process.versions.bun'], { encoding: 'utf8' });
    if (probe.status !== 0 || !probe.stdout.trim() || probe.stdout.trim() === 'undefined') {
      console.error('the node -> Bun shim does not run Bun');
      process.exit(1);
    }
    process.exit(0);
  }
  default:
    console.log('usage: bun-react-native <init | doctor | compare <metro-dir> <bun-dir> | eas-build-post-install>');
    process.exit(command && command !== 'help' && command !== '--help' ? 1 : 0);
}
