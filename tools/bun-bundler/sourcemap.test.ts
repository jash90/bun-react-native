// bun test - export source maps in Expo's shape (@expo/metro-config serializer, Metro Generator / Server).
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { createRequire } from 'node:module';

import { PRELUDE_SOURCE, appendDebugId, concatPieces, debugIdFor, devClientMap, finalizeMap, relativeSources } from './sourcemap';

const root = process.cwd();
const req = createRequire(path.join(root, 'package.json'));
const { decode, encode } = req('@jridgewell/sourcemap-codec');

describe('concatPieces', () => {
  test('keeps each piece on its own lines and merges sources and names', () => {
    const a = { version: 3, sources: ['/p/a.js'], sourcesContent: ['A'], names: ['x'], mappings: encode([[[0, 0, 0, 0, 0]]]) };
    const b = { version: 3, sources: ['/p/b.js', '/p/a.js'], names: ['y', 'x'], mappings: encode([[[2, 1, 4, 0, 1]], [[0, 0, 1, 1, 0]]]) };
    const { code, map } = concatPieces([{ code: 'prelude;', source: PRELUDE_SOURCE }, { code: 'a()', map: a }, { code: 'b()\nc()', map: b }], req);
    expect(code).toBe('prelude;\na()\nb()\nc()');
    expect(map.sources).toEqual([PRELUDE_SOURCE, '/p/a.js', '/p/b.js']);
    expect(map.sourcesContent).toEqual(['prelude;', 'A', null]);
    expect(map.names).toEqual(['x', 'y']);
    // line 0: prelude listed without mappings; b's source 1 (= a.js) and name 1 (= x) are remapped
    expect(decode(map.mappings)).toEqual([[], [[0, 1, 0, 0, 0]], [[2, 1, 4, 0, 0]], [[0, 2, 1, 1, 1]]]);
  });
});

describe('finalizeMap', () => {
  const ctxDir = path.join(root, 'src/app');
  const filter = { pattern: '\\.tsx$', flags: '' };
  const context = `rn-context:\0require-context:${JSON.stringify({ dir: ctxDir, recursive: true, filter, mode: 'sync' })}`;
  const raw = {
    version: 3,
    sources: [PRELUDE_SOURCE, 'src/app/index.tsx', path.join(root, 'node_modules/react/index.js'), path.join(root, 'node_modules/expo-router/entry.js'), `rn-asset:${path.join(root, 'assets/a.png')}`, context, 'rn-virtual:\0polyfill:x', 'rn-empty:empty:fs'],
    names: [],
    mappings: '',
  };
  const fm = { names: ['<global>'], mappings: 'AAA' };
  const map = finalizeMap(raw, { projectRoot: root, serverRoot: root, projectRequire: req, functionMaps: new Map([[path.join(root, 'src/app/index.tsx'), fm]]), debugId: 'id-1' });

  test('sources are /-relative to the server root, namespaces dropped, require.context gets Metro ids', () => {
    const { deriveAbsolutePathFromContext } = req('metro/private/lib/contextModule');
    const ctxId = '/' + path.relative(root, deriveAbsolutePathFromContext(ctxDir, { mode: 'sync', recursive: true, filter }));
    expect(map.sources).toEqual([PRELUDE_SOURCE, '/src/app/index.tsx', '/node_modules/react/index.js', '/node_modules/expo-router/entry.js', '/assets/a.png', ctxId, '\0polyfill:x', '\0empty:fs']);
    expect(ctxId).toMatch(/^\/src\/app\?ctx=[0-9a-f]{40}$/);
    expect(map.sources.some((s) => s.includes(root))).toBe(false);
  });
  test('ignore list: prelude, node_modules (not expo-router/entry), ?ctx= and virtual modules', () => {
    expect(map.x_google_ignoreList).toEqual([0, 2, 5, 6, 7]);
  });
  test('function maps and debug id', () => {
    expect(map.x_facebook_sources).toEqual([null, [fm], null, null, null, null, null, null]);
    expect(map.debugId).toBe('id-1');
  });
  test('server functions keep project-relative sources', () => {
    expect(relativeSources({ ...raw, sources: [path.join(root, 'src/app/api/x+api.ts'), `rn-asset:${path.join(root, 'a.png')}`] }, { projectRoot: root, projectRequire: req }).sources).toEqual(['src/app/api/x+api.ts', 'a.png']);
  });
  test('dev maps: absolute sources, function maps, ignore list', () => {
    const dev = devClientMap({ version: 3, sources: ['src/app/index.tsx', 'node_modules/react/index.js'], names: [], mappings: '', ignoreList: [] }, { projectRoot: root, projectRequire: req, functionMapOf: (f) => (f.endsWith('index.tsx') ? fm : null) });
    expect(dev.sources).toEqual([path.join(root, 'src/app/index.tsx'), path.join(root, 'node_modules/react/index.js')]);
    expect(dev.x_facebook_sources).toEqual([[fm], null]);
    expect(dev.x_google_ignoreList).toEqual([1]);
    expect('ignoreList' in dev).toBe(false);
  });
});

test('debug ids: Expo stringToUUID of the file stem; spliced into finished maps', () => {
  const id = debugIdFor('entry-76d2910352cfe2dca69abeba0c1a8a2a', req);
  expect(id).toBe('bb3e99a3-f3f0-4df7-83e8-3c43b9808687'); // the id Metro wrote for that bundle
  expect(JSON.parse(appendDebugId('{"version":3}', id))).toEqual({ version: 3, debugId: id });
});
