// `bun-react-native init`: wire the package into an app directory. Idempotent and non-destructive: it adds what is
// missing and prints what it cannot change safely (app.config.js, old lockfiles, version pins).
import fs from 'node:fs';
import path from 'node:path';

import {
  appJsonWithPlugin,
  BUNFIG_HEADER,
  bunfigWithPreload,
  dynamicAppConfig,
  loadProject,
  otherLockfiles,
  PLUGIN,
  readJson,
  writeJson,
} from './project';

const EAS_HOOK = 'bun-react-native eas-build-post-install';

export function init(dir: string): { changed: string[]; todo: string[] } {
  const project = loadProject(dir);
  const { root } = project;
  const changed: string[] = [];
  const todo: string[] = [];
  const update = (file: string, next: string) => {
    const full = path.join(root, file);
    const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    if (current === next) return;
    fs.writeFileSync(full, next);
    changed.push(file);
  };

  // bunfig.toml: the preload is what makes every Expo CLI / Metro / Jest process use Bun correctly
  const bunfig = path.join(root, 'bunfig.toml');
  const currentBunfig = fs.existsSync(bunfig) ? fs.readFileSync(bunfig, 'utf8') : BUNFIG_HEADER;
  update('bunfig.toml', bunfigWithPreload(currentBunfig));

  // config plugin (Xcode NODE_BINARY)
  const dynamic = dynamicAppConfig(root);
  if (fs.existsSync(path.join(root, 'app.json'))) {
    const appJson = readJson(path.join(root, 'app.json'));
    const before = JSON.stringify(appJson);
    appJsonWithPlugin(appJson);
    if (JSON.stringify(appJson) !== before) {
      writeJson(path.join(root, 'app.json'), appJson);
      changed.push('app.json');
    }
  }
  if (dynamic) todo.push(`${dynamic}: add "${PLUGIN}" to plugins (and remove ./plugins/with-bun-* entries if present)`);

  // EAS Build: Bun version for the worker, and the node -> Bun shim on PATH for the native build steps
  const easFile = path.join(root, 'eas.json');
  if (fs.existsSync(easFile)) {
    const eas = readJson(easFile);
    const before = JSON.stringify(eas);
    for (const profile of Object.values<any>(eas.build ?? {})) {
      if (!profile.extends && !profile.bun) profile.bun = Bun.version;
    }
    if (JSON.stringify(eas) !== before) {
      writeJson(easFile, eas);
      changed.push('eas.json');
    }
    const pkgFile = path.join(root, 'package.json');
    const pkg = readJson(pkgFile);
    pkg.scripts ??= {};
    if (!pkg.scripts['eas-build-post-install']) {
      pkg.scripts['eas-build-post-install'] = EAS_HOOK;
      writeJson(pkgFile, pkg);
      changed.push('package.json');
    } else if (!pkg.scripts['eas-build-post-install'].includes(EAS_HOOK)) {
      todo.push(`package.json: add "${EAS_HOOK}" to the existing eas-build-post-install script`);
    }
  }

  // things only the user should do
  const locks = otherLockfiles(root);
  if (locks.length) todo.push(`run \`bun install\` (migrates ${locks.join(', ')} to bun.lock, same versions), then delete ${locks.join(', ')}`);
  if (!project.installed('expo')) todo.push('dependencies are not installed yet: run `bun install`');
  return { changed, todo };
}
