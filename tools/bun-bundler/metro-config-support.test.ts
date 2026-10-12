// bun test - which metro.config.js the Bun bundler honours, and when a command goes to Metro.
import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { differences, metroEngineDecision } from './metro-config-support';

const repo = process.cwd();

/** a project with the repo's package.json, app.json and node_modules, plus the given files */
function project(files: Record<string, string>, appJson?: (app: any) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-rn-metrocfg-'));
  fs.copyFileSync(path.join(repo, 'package.json'), path.join(dir, 'package.json'));
  const app = JSON.parse(fs.readFileSync(path.join(repo, 'app.json'), 'utf8'));
  // local config plugins (./plugins/...) are not part of the temporary project
  app.expo.plugins = (app.expo.plugins ?? []).filter((p: any) => !String(Array.isArray(p) ? p[0] : p).startsWith('./'));
  appJson?.(app);
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(app));
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

const header = `const { getDefaultConfig } = require('expo/metro-config');\nconst config = getDefaultConfig(__dirname);\n`;

test('differences compares arrays whole and functions by source', () => {
  expect(differences({ a: [1, 2], f: () => 1, r: /x/ }, { a: [1, 2], f: () => 1, r: /x/ })).toEqual([]);
  expect(differences({ a: [1, 2], b: { c: 1 } }, { a: [2, 1], b: { c: 2 } })).toEqual(['a', 'b.c']);
  expect(differences({ f: () => 1 }, { f: () => 2 })).toEqual(['f']);
});

test('no metro.config.js and Bun toolchain settings keep the Bun bundler', () => {
  expect(metroEngineDecision(project({})).engine).toBe('bun');
  const own = project({
    'metro.config.js': `${header}config.transformer.unstable_workerThreads = false;\nconfig.cacheVersion = 'x';\nmodule.exports = config;`,
  });
  expect(metroEngineDecision(own)).toMatchObject({ engine: 'bun', config: { babelTransformerPath: null } });
});

test('extensions and a custom Babel transformer are honoured', () => {
  const dir = project({
    'svg-transformer.js': `exports.transform = (args) => require('@expo/metro-config/build/babel-transformer').transform(args);`,
    'metro.config.js': `${header}config.transformer = { ...config.transformer, babelTransformerPath: require.resolve('./svg-transformer') };
config.resolver = { ...config.resolver, assetExts: config.resolver.assetExts.filter((e) => e !== 'svg'), sourceExts: [...config.resolver.sourceExts, 'svg'] };
module.exports = config;`,
  });
  const decision: any = metroEngineDecision(dir);
  expect(decision.engine).toBe('bun');
  expect(decision.config.babelTransformerPath).toBe(path.join(fs.realpathSync(dir), 'svg-transformer.js'));
  expect(decision.config.sourceExts).toContain('svg');
  expect(decision.config.assetExts).not.toContain('svg');
});

test('other customizations, function exports and React Server Components go to Metro', () => {
  const wrapped = project({
    'metro.config.js': `${header}const s = config.serializer.customSerializer;\nconfig.serializer.customSerializer = (...a) => s(...a);\nmodule.exports = config;`,
  });
  expect(metroEngineDecision(wrapped)).toEqual({ engine: 'metro', reasons: ['metro.config: serializer.customSerializer'] });
  const fn = project({ 'metro.config.js': `module.exports = async () => ({});` });
  expect(metroEngineDecision(fn)).toEqual({ engine: 'metro', reasons: ['metro.config.js exports a function or promise'] });
  const rsc = project({}, (app) => (app.expo.experiments = { ...app.expo.experiments, reactServerFunctions: true }));
  expect(metroEngineDecision(rsc)).toEqual({ engine: 'metro', reasons: ['React Server Components'] });
});
