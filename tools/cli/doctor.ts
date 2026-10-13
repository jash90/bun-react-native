// `bun-react-native doctor`: is this app directory set up to run its toolchain on Bun, and which engine bundles it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { metroEngineDecision } from '../bun-bundler/metro-config-support';
import { dynamicAppConfig, legacyMetroConfigLines, loadProject, MIN_BUN, otherLockfiles, PACKAGE_ROOT, PLUGIN, PRELOAD, SUPPORTED_SDKS, versionAtLeast } from './project';

export type Check = { ok: boolean | 'warn'; title: string; detail?: string };

export function doctor(dir: string): Check[] {
  const checks: Check[] = [];
  const add = (ok: Check['ok'], title: string, detail?: string) => checks.push({ ok, title, detail });
  const project = loadProject(dir);
  const { root } = project;

  add(versionAtLeast(Bun.version, MIN_BUN), `Bun ${Bun.version}`, versionAtLeast(Bun.version, MIN_BUN) ? undefined : `bun-react-native needs Bun >= ${MIN_BUN}: bun upgrade`);

  const expo = project.installed('expo');
  if (!expo) add(false, 'expo is not installed', 'run `bun install`');
  else add(SUPPORTED_SDKS.includes(project.expoMajor!) ? true : 'warn', `Expo SDK ${project.expoMajor} (expo ${expo})`, SUPPORTED_SDKS.includes(project.expoMajor!) ? undefined : `verified with SDK ${SUPPORTED_SDKS.join(' and ')}`);

  const bunfig = path.join(root, 'bunfig.toml');
  const bunfigText = fs.existsSync(bunfig) ? fs.readFileSync(bunfig, 'utf8') : '';
  add(bunfigText.includes(PRELOAD), `bunfig.toml preload "${PRELOAD}"`, bunfigText.includes(PRELOAD) ? undefined : 'run `bunx bun-react-native init`');
  const installTable = bunfigText.split(/^\[(?=install\])/m)[1]?.split(/^\[/m)[0] ?? '';
  if (bunfigText.includes(PRELOAD) && !/^\s*auto\s*=\s*"disable"/m.test(installTable)) {
    add('warn', 'bunfig.toml [install] auto is not "disable"', 'Bun may auto-install packages Expo probes globally (sharp-cli) and then resolve modules wrongly (KNOWN-ISSUES #22)');
  }
  if (/^\s*\[run\][^[]*^\s*bun\s*=\s*true/ms.test(bunfigText)) add(false, 'bunfig.toml sets [run] bun = true', "remove it: it puts Bun's buggy `node` alias in front of the shim (oven-sh/bun#40482)");

  if (expo) {
    try {
      const { exp } = project.req('@expo/config').getConfig(root, { skipSDKVersionRequirement: true });
      const plugins: any[] = exp.plugins ?? [];
      const has = plugins.some((p) => (Array.isArray(p) ? p[0] : p) === PLUGIN);
      add(has, `config plugin "${PLUGIN}"`, has ? undefined : dynamicAppConfig(root) ? `add it to ${dynamicAppConfig(root)}` : 'run `bunx bun-react-native init`');
    } catch (e: any) {
      add('warn', 'could not read the app config', e.message.split('\n')[0]);
    }
  }

  // `node` as the toolchain's child processes see it (from the app directory this process has the preload's PATH).
  // Bun's own `node` alias runs Bun too, but drops the first argument after --eval (oven-sh/bun#40482): probe that.
  const shimDir = path.join(PACKAGE_ROOT, 'tools', 'bin');
  const probe = spawnSync('node', ['--eval', 'process.stdout.write((process.versions.bun || "node " + process.version) + " " + process.argv[1])', 'probe'], { encoding: 'utf8', cwd: root });
  const [runtime, arg] = (probe.stdout ?? '').trim().split(' ');
  const which = Bun.which('node', { PATH: process.env.PATH ?? '' });
  if (probe.status !== 0 || !runtime) add(false, '`node` in child processes: not found', `put ${shimDir} first on PATH`);
  else if (runtime === 'node') add('warn', `\`node\` in child processes -> Node.js ${probe.stdout.trim().split(' ')[1]}`, `works, but the toolchain is not 100% Bun: run commands with \`bun run\` / \`bun expo\` from the app directory (the preload puts ${shimDir} first)`);
  else if (arg !== 'probe') add(false, `\`node\` in child processes -> Bun's \`node\` alias (${which})`, `it drops the first argument after --eval (oven-sh/bun#40482) and breaks autolinking: put ${shimDir} first on PATH`);
  else add(true, `\`node\` in child processes -> Bun ${runtime}`, which ? `via ${which}` : undefined);
  add('warn', 'Android Studio / Xcode started from the Dock', `do not get the shell PATH: Gradle runs \`node\` from PATH (start Android builds with \`bun expo run:android\` or put ${shimDir} on PATH); Xcode uses NODE_BINARY from ios/.xcode.env (the config plugin)`);

  // dependency versions that must match react-native
  const rn = project.installed('react-native');
  const rnMetroConfig = project.installed('@react-native/metro-config');
  if (rn && rnMetroConfig && rnMetroConfig.split('.').slice(0, 2).join('.') !== rn.split('.').slice(0, 2).join('.')) {
    add(false, `@react-native/metro-config ${rnMetroConfig} does not match react-native ${rn}`, `pin it: bun add -d @react-native/metro-config@${rn}`);
  }
  const locks = otherLockfiles(root);
  if (locks.length) add('warn', `other lockfiles: ${locks.join(', ')}`, 'keep only bun.lock (EAS picks the package manager from the lockfile)');
  for (const line of legacyMetroConfigLines(root)) add('warn', `metro.config.js: \`${line}\``, 'no longer needed - the package applies it');

  if (expo) {
    const decision = metroEngineDecision(root);
    const engine = process.env.RN_BUNDLER === 'bun' ? (decision.engine === 'bun' ? 'Bun bundler (RN_BUNDLER=bun)' : 'Metro on Bun (RN_BUNDLER=bun, but the project needs Metro)') : 'Metro on Bun (default)';
    add(true, `engine: ${engine}`, decision.engine === 'metro' ? `RN_BUNDLER=bun would stay on Metro: ${decision.reasons.join(', ')}` : 'RN_BUNDLER=bun can use the Bun bundler for this project');
  }

  const xcodeEnv = path.join(root, 'ios', '.xcode.env');
  if (fs.existsSync(xcodeEnv)) {
    const ok = /NODE_BINARY=.*bun/.test(fs.readFileSync(xcodeEnv, 'utf8'));
    add(ok, 'ios/.xcode.env NODE_BINARY -> Bun', ok ? undefined : 'run `bun expo prebuild` (the config plugin writes it)');
  }
  return checks;
}
