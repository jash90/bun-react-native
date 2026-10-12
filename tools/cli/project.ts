// What `bun-react-native init` / `doctor` read and write in an app directory (the directory with package.json and
// app.json; in a monorepo the app's directory, not the workspace root).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const PACKAGE_ROOT = path.resolve(import.meta.dir, '../..');
export const PRELOAD = 'bun-react-native/preload';
export const PLUGIN = 'bun-react-native';
export const MIN_BUN = '1.4.3';
/** Expo SDK majors this version is verified with */
export const SUPPORTED_SDKS = [57, 58];

export function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file: string, value: unknown) {
  // keep the file's indentation (2 spaces when it cannot be detected)
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const indent = current.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
  fs.writeFileSync(file, JSON.stringify(value, null, indent) + '\n');
}

export function versionAtLeast(version: string, min: string) {
  const a = version.split(/[.+-]/).map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  return true;
}

export interface Project {
  root: string;
  pkg: any;
  req: NodeRequire;
  /** installed version of a package resolved from the app, null when not installed */
  installed(name: string): string | null;
  expoMajor: number | null;
}

export function loadProject(dir: string): Project {
  const root = fs.realpathSync(dir);
  const pkgFile = path.join(root, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new Error(`no package.json in ${root} - run this in the app directory`);
  const pkg = readJson(pkgFile);
  const req = createRequire(pkgFile);
  const installed = (name: string) => {
    try {
      return readJson(req.resolve(`${name}/package.json`)).version as string;
    } catch {
      return null;
    }
  };
  const expo = installed('expo') ?? String(pkg.dependencies?.expo ?? '').replace(/^[~^]/, '');
  const expoMajor = expo ? Number(expo.split('.')[0]) || null : null;
  return { root, pkg, req, installed, expoMajor };
}

/** bunfig.toml with the package preload, `env = false` and the hoisted linker, keeping what the file already has */
export function bunfigWithPreload(current: string): string {
  let text = current;
  const preload = text.match(/^preload\s*=\s*\[([^\]]*)\]/m);
  if (!preload) {
    text = `preload = ["${PRELOAD}"]\n` + text;
  } else if (!preload[1].includes(PRELOAD)) {
    const items = preload[1].trim();
    text = text.replace(preload[0], `preload = [${items ? `${items}, ` : ''}"${PRELOAD}"]`);
  }
  // top-level keys must come before the first [table]
  const firstTable = text.search(/^\[/m);
  const top = firstTable < 0 ? text : text.slice(0, firstTable);
  if (!/^env\s*=/m.test(top)) {
    const line = '# No automatic .env loading (like Node): Expo CLI loads .env.<mode> for each command itself.\nenv = false\n';
    text = firstTable < 0 ? `${text.trimEnd()}\n${line}` : `${top.trimEnd()}\n${line}\n${text.slice(firstTable)}`;
  }
  if (!/^\[install\]/m.test(text)) {
    text = `${text.trimEnd()}\n\n[install]\n# The isolated linker duplicates Expo native modules (oven-sh/bun#29343).\nlinker = "hoisted"\n`;
  }
  return text.endsWith('\n') ? text : text + '\n';
}

export const BUNFIG_HEADER =
  '# bun-react-native: every Bun process started in this app directory (Expo CLI, Metro, Jest, the Gradle/Xcode\n' +
  '# bundle steps) loads its preload. Bun reads bunfig.toml only from the current working directory.\n';

/** app.json `expo.plugins` with the package plugin; null when the config is app.config.js/ts (edited by hand) */
export function appJsonWithPlugin(appJson: any): any {
  const expo = appJson.expo ?? appJson;
  const plugins: any[] = expo.plugins ?? [];
  const has = plugins.some((p) => (Array.isArray(p) ? p[0] : p) === PLUGIN);
  // the plugin files this repo used before it was a package
  const legacy = (p: any) => typeof p === 'string' && /plugins\/with-bun-(xcode-env|bundler)$/.test(p);
  const next = plugins.filter((p) => !legacy(p));
  if (!has) next.push(PLUGIN);
  expo.plugins = next;
  return appJson;
}

export function dynamicAppConfig(root: string) {
  return ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'].find((f) => fs.existsSync(path.join(root, f))) ?? null;
}

export function otherLockfiles(root: string) {
  return ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json'].filter((f) => fs.existsSync(path.join(root, f)));
}

/** metro.config.js lines from the copy-the-files setup that the package now applies itself */
export function legacyMetroConfigLines(root: string) {
  const file = ['metro.config.js', 'metro.config.cjs'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!file) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => /unstable_workerThreads\s*=\s*false|tools\/bun\/metro-(minifier|worker-farm)/.test(l))
    .map((l) => l.trim());
}
