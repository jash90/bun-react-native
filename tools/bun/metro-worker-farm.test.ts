// bun test - Metro's WorkerFarm on Bun worker threads: Metro's Worker.js results and jest-worker-like errors.
import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const projectRoot = process.cwd();
const req = createRequire(path.join(projectRoot, 'package.json'));
require('./metro-worker-farm').install(projectRoot);
const WorkerFarm = req('metro/private/DeltaBundler/WorkerFarm').default;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-rn-farm-'));
const transformerPath = path.join(dir, 'transformer.js');
fs.writeFileSync(
  transformerPath,
  `exports.transform = async (config, root, filename, data) => {
    const code = data.toString();
    if (code.includes('syntax')) throw Object.assign(new SyntaxError('Unexpected token (1:2)'), { loc: { line: 1, column: 2 }, codeFrame: '> 1 | x' });
    if (code.includes('plain')) throw new TypeError('boom');
    return { output: [{ type: 'js/module', data: { code: code.toUpperCase() } }], dependencies: [], config };
  };`
);
const farm = new WorkerFarm(
  { maxWorkers: 2, stickyWorkers: true, projectRoot, reporter: { update() {} }, transformer: {} },
  { transformerPath, transformerConfig: { marker: 1 } }
);
afterAll(() => farm.kill());

test('replaces Metro WorkerFarm and runs Metro Worker.js on threads', async () => {
  expect(WorkerFarm.isBunWorkerFarm).toBe(true);
  const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((s) => farm.transform(`${s}.js`, {}, Buffer.from(`code ${s}`))));
  expect(results.map((r: any) => r.result.output[0].data.code)).toEqual(['CODE A', 'CODE B', 'CODE C', 'CODE D', 'CODE E']);
  expect(results[0].result.config).toEqual({ marker: 1 });
  expect(results[0].sha1).toBe(new Bun.CryptoHasher('sha1').update('code a').digest('hex'));
});

test('formats errors like Metro with jest-worker (constructor name as type, own properties kept)', async () => {
  const babel: any = await farm.transform('s.js', {}, Buffer.from('syntax')).catch((e: any) => e);
  expect(babel.type).toBe('TransformError');
  expect(babel.message).toBe('SyntaxError in s.js: Unexpected token (1:2)');
  expect([babel.lineNumber, babel.column, babel.snippet]).toEqual([1, 2, '> 1 | x']);
  const generic: any = await farm.transform('p.js', {}, Buffer.from('plain')).catch((e: any) => e);
  expect(generic.message).toBe('p.js: boom');
  expect(generic.lineNumber).toBe(0);
});
