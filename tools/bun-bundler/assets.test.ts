// bun test - Metro-compatible asset records (metro/src/Assets.js) and require.context modules
// (metro/src/lib/contextModuleTemplates.js) of the Bun bundler.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assetModuleSource, getAssetData, getAssetRecord } from './assets';
import { contextModuleSource, listContextFiles, metafileOrder } from './shared';

let root: string;
const write = (rel: string, content: string | Uint8Array = '') => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
/** minimal PNG header: signature + IHDR with the given size */
const png = (width: number, height: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
};
const names = (files: string[]) => files.map((f) => path.basename(f));

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bun-rn-assets-')));
  // generic variants only, two files with scale 1
  write('img/close.png', png(10, 10));
  write('img/close@1x.png', png(10, 10));
  write('img/close@3x.png', png(30, 30));
  write('img/close@2x.png', png(20, 20));
  // platform variants replace the generic file
  write('img/back.png', png(5, 5));
  write('img/back@1x.ios.png', png(8, 8));
  write('img/back@2x.ios.png', png(16, 16));
  write('img/back@1x.android.png', png(9, 9));
  // only a scaled file
  write('img/hero@2x.png', png(200, 100));
  // require.context
  write('app/a/b.tsx');
  write('app/a-b.tsx');
  write('app/index.tsx');
  write('app/node_modules/x.tsx');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('asset records (metro getAbsoluteAssetRecord)', () => {
  test('scales ascending; equal scales in sorted directory order', () => {
    const r = getAssetRecord(path.join(root, 'img/close.png'), 'ios');
    expect(r.scales).toEqual([1, 1, 2, 3]);
    expect(names(r.files)).toEqual(['close.png', 'close@1x.png', 'close@2x.png', 'close@3x.png']);
  });

  test("the platform's own variants replace the generic files", () => {
    expect(names(getAssetRecord(path.join(root, 'img/back.png'), 'ios').files)).toEqual(['back@1x.ios.png', 'back@2x.ios.png']);
    expect(names(getAssetRecord(path.join(root, 'img/back.png'), 'android').files)).toEqual(['back@1x.android.png']);
    expect(names(getAssetRecord(path.join(root, 'img/back.png'), 'web').files)).toEqual(['back.png']);
  });

  test('asset data: dimensions of the first file divided by its scale, Expo fileHashes, no internals in the module', () => {
    const data = getAssetData([path.join(root, 'img/hero@2x.png')], root, '/assets', 'ios');
    expect(data).toMatchObject({ name: 'hero', type: 'png', scales: [2], width: 100, height: 50, httpServerLocation: '/assets/img' });
    expect(data.fileHashes).toHaveLength(1);
    expect(data.fileSystemLocation).toBe(path.join(root, 'img'));
    const src = assetModuleSource(data, 'registry');
    expect(src).not.toContain('fileSystemLocation');
    expect(src).not.toContain('"files"');
  });
});

describe('require.context (metro contextModuleTemplates)', () => {
  const evaluate = (code: string, load: (i: number) => any) => {
    const module = { exports: null as any };
    new Function('module', 'require', code)(module, (id: string) => load(Number(id)));
    return module.exports;
  };

  test('keys sorted by whole path, node_modules skipped', () => {
    expect(listContextFiles(path.join(root, 'app'), true, /\.tsx$/)).toEqual(['./a-b.tsx', './a/b.tsx', './index.tsx']);
  });

  test('sync: modules behind getters, unknown keys are undefined, resolve is unimplemented', () => {
    const loaded: number[] = [];
    const files = ['./a.tsx', './b.tsx'];
    const ctx = evaluate(
      contextModuleSource({ dir: '/x', recursive: true, filter: { pattern: '', flags: '' }, mode: 'sync' }, files, (i) => `require(${i})`),
      (i) => (loaded.push(i), { id: i })
    );
    expect(ctx.keys()).toEqual(files);
    expect(loaded).toEqual([]);
    expect(ctx('./b.tsx')).toEqual({ id: 1 });
    expect(ctx('expo-router/build/views/Unmatched.js')).toBeUndefined();
    expect(() => ctx.resolve('./a.tsx')).toThrow('Unimplemented');
  });

  test('empty context throws MODULE_NOT_FOUND', () => {
    const ctx = evaluate(contextModuleSource({ dir: '/x', recursive: true, filter: { pattern: '', flags: '' }, mode: 'sync' }, [], () => ''), () => null);
    expect(() => ctx('./a')).toThrow('No modules in context');
    expect(ctx.keys()).toEqual([]);
  });
});

test('metafile order: depth-first in import order (pre = graph order, post = CSS order)', () => {
  const metafile = {
    inputs: {
      'rn-virtual:\0entry': { imports: [{ path: '/p/a.js' }, { path: 'rn-asset:/p/img.png' }] },
      '/p/a.js': { imports: [{ path: '/p/b.css' }, { path: '/p/c.js' }] },
      '/p/c.js': { imports: [{ path: '/p/b.css' }] },
    },
  };
  const { pre, post } = metafileOrder(metafile, '\0entry');
  expect(pre).toEqual(['\0entry', '/p/a.js', '/p/b.css', '/p/c.js', '/p/img.png']);
  expect(post).toEqual(['/p/b.css', '/p/c.js', '/p/a.js', '/p/img.png', '\0entry']);
});
