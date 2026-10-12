// bun test - Metro-equivalent pieces of the native dev server: HMR client URLs (metro/HmrServer) and dependency keys
// (metro/DeltaBundler/Graph semantics).
import { expect, test } from 'bun:test';

import { metroDependencyTargets, metroHmrClientUrl } from './dev-graph-metro';

test('HMR client URL like metro/HmrServer _registerEntryPoint', () => {
  const url = metroHmrClientUrl('http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true&hot=false&lazy=true&bundleEntry=x');
  expect(url).toBe('http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true&hot=false&lazy=true&minify=false&modulesOnly=true&runModule=false&shallow=true');
});

test('dependency keys: context modules, context template files, optional misses, lazy only for files', () => {
  const dep = (name: string, data: object) => ({ name, data: { asyncType: null, key: name, ...data } }) as any;
  const keys = {
    resolve: (spec: string, from: string) => {
      if (spec === 'missing') throw new Error('Unable to resolve');
      return spec.startsWith('\0') ? spec : `${from}->${spec}`;
    },
    contextKey: (spec: any) => `ctx:${spec.dir}:${spec.mode}`,
    missingKey: (spec: string) => `missing:${spec}`,
  };
  const out = metroDependencyTargets(
    [
      dep('./a', {}),
      dep('./lazy', { asyncType: 'async' }),
      dep('\0polyfill:x', { asyncType: 'async' }),
      dep('missing', { isOptional: true }),
      dep('./app', { contextParams: { recursive: true, filter: { pattern: '.*', flags: '' }, mode: 'lazy' } }),
    ],
    '/p/src/index.ts',
    undefined,
    keys
  );
  expect(out).toEqual([
    { key: '/p/src/index.ts->./a', async: false },
    { key: '/p/src/index.ts->./lazy', async: true },
    { key: '\0polyfill:x', async: false },
    { key: 'missing:missing', async: false },
    { key: 'ctx:/p/src/app:lazy', async: false },
  ]);
  expect(() => metroDependencyTargets([dep('missing', {})], '/p/a.ts', undefined, keys)).toThrow('Unable to resolve');
  // a context template requires the matched files by absolute path
  expect(metroDependencyTargets([dep('/p/src/app/index.tsx', {})], '/p/src/app?ctx=1', { from: '/p/src/app' }, keys)).toEqual([{ key: '/p/src/app/index.js->/p/src/app/index.tsx', async: false }]);
});
