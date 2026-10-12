// The Metro package Expo CLI runs (@expo/cli -> @expo/metro -> metro) and a require from it. A project can hold
// several Metro versions (e.g. a hoisted `metro` from a `*` peer next to @expo/metro's own copy, KNOWN-ISSUES #9);
// Metro internals (`metro/private/...`) and its helper packages (metro-source-map, metro-transform-plugins,
// metro-resolver, metro-symbolicate) must come from the copy Expo CLI uses.
'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');

const dirs = new Map();

/** directory of the Metro package Expo CLI uses (falls back to the project's `metro`) */
function expoMetroDir(projectRoot) {
  let dir = dirs.get(projectRoot);
  if (dir) return dir;
  const fromProject = createRequire(path.join(projectRoot, 'package.json'));
  try {
    const cli = createRequire(fromProject.resolve('@expo/cli/package.json'));
    const expoMetro = createRequire(cli.resolve('@expo/metro/package.json'));
    dir = path.dirname(expoMetro.resolve('metro/package.json'));
  } catch {
    dir = path.dirname(fromProject.resolve('metro/package.json'));
  }
  dirs.set(projectRoot, dir);
  return dir;
}

/** `require` for Metro modules: `metro/private/<x>` from Expo CLI's Metro, other specifiers resolved from it */
function metroRequire(projectRoot) {
  const dir = expoMetroDir(projectRoot);
  const req = createRequire(path.join(dir, 'package.json'));
  return (spec) => (spec.startsWith('metro/private/') ? req(path.join(dir, 'src', spec.slice('metro/private/'.length))) : req(spec));
}

module.exports = { expoMetroDir, metroRequire };
