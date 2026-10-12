// bun test - React Native resolution rules of the Bun bundler (Metro-equivalent behaviour).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ASSET_REGISTRY_VIRTUAL, Resolver } from './resolver';
import { ASSET_EXTS, SOURCE_EXTS } from './bundle';

let root: string;
const write = (rel: string, content = '') => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const resolver = (platform = 'ios') =>
  new Resolver({
    projectRoot: root,
    platform,
    sourceExts: SOURCE_EXTS,
    assetExts: ASSET_EXTS,
    tsconfigPaths: { baseUrl: root, paths: { '@/*': ['./src/*'] } },
  });
const rel = (r: any) => (r.type === 'sourceFile' ? path.relative(root, r.filePath) : r);

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bun-rn-resolver-')));
  write('package.json', '{"name":"app"}');
  write('src/app.tsx');
  // platform extensions
  write('src/button.ios.tsx');
  write('src/button.native.tsx');
  write('src/button.tsx');
  write('src/only-native.native.js');
  write('src/only-native.js');
  write('src/order.js');
  write('src/order.ts');
  write('src/dir/index.ts');
  // packages
  write('node_modules/rn-field/package.json', JSON.stringify({ main: 'lib/main.js', 'react-native': 'lib/rn.js' }));
  write('node_modules/rn-field/lib/main.js');
  write('node_modules/rn-field/lib/rn.js');
  write('node_modules/browser-map/package.json', JSON.stringify({ main: 'index.js', browser: { './server.js': false, fs: false } }));
  write('node_modules/browser-map/index.js');
  write('node_modules/browser-map/server.js');
  write(
    'node_modules/with-exports/package.json',
    JSON.stringify({
      exports: {
        '.': { 'react-native': './rn.js', import: './esm.js', require: './cjs.js', default: './default.js' },
        './feature': { import: './feature.mjs', require: './feature.cjs' },
        './sub/*': './subs/*.js',
      },
    })
  );
  for (const f of ['rn.js', 'esm.js', 'cjs.js', 'default.js', 'feature.mjs', 'feature.cjs', 'subs/a.js']) write(`node_modules/with-exports/${f}`);
  write('node_modules/@scope/pkg/package.json', JSON.stringify({ main: './dist/index.js' }));
  write('node_modules/@scope/pkg/dist/index.js');
  write('node_modules/react-native/Libraries/Utilities/HMRClient.js');
  write('node_modules/react-native/package.json', '{"name":"react-native"}');
  write('node_modules/expo/package.json', '{"name":"expo"}');
  write('node_modules/expo/src/async-require/hmr.ts');
  // assets
  write('assets/icon.png');
  write('assets/icon@2x.png');
  write('assets/icon@3x.png');
  write('assets/other.png');
  write('assets/hero@2x.png');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const from = () => path.join(root, 'src/app.tsx');

describe('Resolver (Metro-equivalent)', () => {
  test('platform extension order: .ios > .native > plain', () => {
    expect(rel(resolver('ios').resolve('./button', from(), true))).toBe('src/button.ios.tsx');
    expect(rel(resolver('android').resolve('./button', from(), true))).toBe('src/button.native.tsx');
    expect(rel(resolver('android').resolve('./only-native', from(), true))).toBe('src/only-native.native.js');
  });

  test('source extension order follows sourceExts (ts before js)', () => {
    expect(rel(resolver().resolve('./order', from(), true))).toBe('src/order.ts');
  });

  test('directory index and tsconfig paths', () => {
    expect(rel(resolver().resolve('./dir', from(), true))).toBe('src/dir/index.ts');
    expect(rel(resolver().resolve('@/button', from(), true))).toBe('src/button.ios.tsx');
  });

  test('main fields: react-native wins over main', () => {
    expect(rel(resolver().resolve('rn-field', from(), true))).toBe('node_modules/rn-field/lib/rn.js');
  });

  test('browser field replacement map: false -> empty module', () => {
    const r = resolver();
    expect(r.resolve('fs', path.join(root, 'node_modules/browser-map/index.js'), false)).toEqual({ type: 'empty' });
    expect(r.resolve('./server.js', path.join(root, 'node_modules/browser-map/index.js'), false)).toEqual({ type: 'empty' });
  });

  test('package exports: react-native condition, import/require, subpath patterns', () => {
    const r = resolver();
    expect(rel(r.resolve('with-exports', from(), true))).toBe('node_modules/with-exports/rn.js');
    expect(rel(r.resolve('with-exports/feature', from(), true))).toBe('node_modules/with-exports/feature.mjs');
    expect(rel(r.resolve('with-exports/feature', from(), false))).toBe('node_modules/with-exports/feature.cjs');
    expect(rel(r.resolve('with-exports/sub/a', from(), true))).toBe('node_modules/with-exports/subs/a.js');
  });

  test('scoped packages', () => {
    expect(rel(resolver().resolve('@scope/pkg', from(), true))).toBe('node_modules/@scope/pkg/dist/index.js');
  });

  test('assets resolve to every scale variant', () => {
    const r = resolver().resolve('../assets/icon.png', from(), true) as any;
    expect(r.type).toBe('assetFiles');
    expect(r.filePaths.map((f: string) => path.basename(f))).toEqual(['icon.png', 'icon@2x.png', 'icon@3x.png']);
  });

  test('assets exist like in Metro: base or an assetResolutions variant; a scaled specifier does not resolve', () => {
    expect((resolver().resolve('../assets/hero.png', from(), true) as any).type).toBe('assetFiles');
    expect(() => resolver().resolve('../assets/icon@2x.png', from(), true)).toThrow();
  });

  test('Expo layers: asset registry is virtual, HMRClient is redirected to expo', () => {
    const r = resolver();
    expect(r.resolve('@react-native/assets-registry/registry', from(), false)).toEqual({ type: 'sourceFile', filePath: ASSET_REGISTRY_VIRTUAL });
    expect(rel(r.resolve('react-native/Libraries/Utilities/HMRClient', from(), false))).toBe('node_modules/expo/src/async-require/hmr.ts');
  });

  test('web: react-native-web alias, browser field, node builtins without a package are empty', () => {
    write('node_modules/react-native-web/package.json', JSON.stringify({ main: 'dist/index.js' }));
    write('node_modules/react-native-web/dist/index.js');
    write('node_modules/web-field/package.json', JSON.stringify({ main: 'node.js', browser: 'browser.js' }));
    write('node_modules/web-field/node.js');
    write('node_modules/web-field/browser.js');
    write('node_modules/events/package.json', JSON.stringify({ main: 'events.js' }));
    write('node_modules/events/events.js');
    const r = new Resolver({
      projectRoot: root,
      platform: 'web',
      sourceExts: SOURCE_EXTS,
      assetExts: ASSET_EXTS,
      mainFields: ['browser', 'module', 'main'],
      conditionsByPlatform: { web: ['browser'] },
      preferNativePlatform: false,
      exactAliases: { 'react-native': 'react-native-web' },
      browserNodeBuiltins: true,
    });
    expect(rel(r.resolve('react-native', from(), true))).toBe('node_modules/react-native-web/dist/index.js');
    expect(rel(r.resolve('web-field', from(), true))).toBe('node_modules/web-field/browser.js');
    expect(rel(r.resolve('events', from(), false))).toBe('node_modules/events/events.js'); // same-named package wins
    expect(r.resolve('node:async_hooks', from(), true)).toEqual({ type: 'empty' });
    expect(rel(r.resolve('./button', from(), true))).toBe('src/button.tsx'); // no .native on web
  });

  test('unresolvable modules throw', () => {
    expect(() => resolver().resolve('does-not-exist', from(), true)).toThrow();
  });
});

describe('Expo CLI resolver layers (withMetroMultiPlatform)', () => {
  const make = (opts: Partial<ConstructorParameters<typeof Resolver>[0]> = {}) =>
    new Resolver({ projectRoot: root, platform: 'ios', sourceExts: SOURCE_EXTS, assetExts: ASSET_EXTS, env: {}, ...opts });

  beforeAll(() => {
    write('node_modules/react/package.json', '{"name":"react","main":"index.js"}');
    write('node_modules/react/index.js');
    write('node_modules/react/cjs/react.production.js');
    write('src/pick.ios.ts');
    write('src/pick.ts');
    write('src/pick2.ios.tsx');
    write('src/pick2.native.ts');
    write('node_modules/expo/package.json', JSON.stringify({ name: 'expo', main: 'index.js', dependencies: { 'only-in-expo': '1' } }));
    write('node_modules/expo/index.js');
    write('node_modules/expo/node_modules/only-in-expo/package.json', '{"name":"only-in-expo","main":"index.js"}');
    write('node_modules/expo/node_modules/only-in-expo/index.js');
    write('node_modules/expo-router/package.json', '{"name":"expo-router","main":"index.js"}');
    write('node_modules/expo-router/index.js');
    write('node_modules/expo-router/react-navigation.js');
    write('node_modules/@react-navigation/core/package.json', '{"name":"@react-navigation/core","main":"index.js"}');
    write('node_modules/@react-navigation/core/index.js');
    write('node_modules/some-lib/index.js');
  });

  test('development: production React builds are empty modules (requestDevMockProdReact)', () => {
    const origin = path.join(root, 'node_modules/react/index.js');
    expect(make({ dev: true }).resolve('./cjs/react.production.js', origin, false)).toEqual({ type: 'empty' });
    expect(rel(make({ dev: false }).resolve('./cjs/react.production.js', origin, false))).toBe('node_modules/react/cjs/react.production.js');
  });

  test('tvOS: every .tvos.* then .ios.* then .native.* extension (Expo platform extensions)', () => {
    const tv = make({ platform: 'tvos', platformExtensions: ['tvos', 'ios', 'native'] });
    expect(rel(tv.resolve('./pick', from(), true))).toBe('src/pick.ios.ts');
    expect(rel(tv.resolve('./pick2', from(), true))).toBe('src/pick2.ios.tsx');
    // plain iOS (Metro order per extension) picks the .native.ts file first
    expect(rel(make().resolve('./pick2', from(), true))).toBe('src/pick2.native.ts');
  });

  test("dependencies of expo resolve from expo's own node_modules (createFallbackModuleResolver)", () => {
    expect(rel(make().resolve('only-in-expo', from(), true))).toBe('node_modules/expo/node_modules/only-in-expo/index.js');
  });

  test('@react-navigation/core is expo-router/react-navigation for libraries, and an error in app code', () => {
    const lib = path.join(root, 'node_modules/some-lib/index.js');
    expect(rel(make().resolve('@react-navigation/core', lib, false))).toBe('node_modules/expo-router/react-navigation.js');
    expect(() => make().resolve('@react-navigation/core', from(), false)).toThrow('no longer compatible with react-navigation');
    expect(rel(make({ env: { EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK: '1' } }).resolve('@react-navigation/core', from(), false))).toBe('node_modules/@react-navigation/core/index.js');
  });
});
