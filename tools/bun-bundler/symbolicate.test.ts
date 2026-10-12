// bun test - `/symbolicate` like Metro's Server._symbolicate (0-based columns, function maps, customizeFrame,
// code frame from graph files only, 400/500 errors).
import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { symbolicateRequest } from './symbolicate';

const req = createRequire(path.join(process.cwd(), 'package.json'));
const { TraceMap } = req('@jridgewell/trace-mapping');
const { encode } = req('@jridgewell/sourcemap-codec');

test('maps 0-based columns, names functions from x_facebook_sources, customizes frames, builds the code frame', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-rn-symbolicate-'));
  const file = path.join(root, 'a.js');
  fs.writeFileSync(file, 'const x = 1;\nfunction foo() {\n  throw new Error("x");\n}\n');
  // generated line 5, column 4 -> original a.js line 3, column 2 (all 0-based in the encoding)
  const raw = { version: 3, sources: [file], names: [], mappings: encode([[], [], [], [], [[4, 0, 2, 2]]]) };
  const served = { ...raw, sources: [file], x_facebook_sources: [[{ names: ['<global>', 'foo'], mappings: 'AAA;CCC' }]] };
  const url = 'http://localhost:8081/index.bundle?platform=ios';
  const deps = {
    projectRoot: process.cwd(),
    mapsFor: (u: string) => (u === url ? { trace: new TraceMap(raw), served } : null),
    isGraphFile: (f: string) => f === file,
    symbolicator: { customizeFrame: (frame: any) => ({ collapse: frame.methodName === 'internal' }) },
  };
  const ok = await symbolicateRequest({ stack: [{ file: url, lineNumber: 5, column: 4, methodName: 'anonymous' }, { file: 'native', methodName: 'internal' }] }, deps);
  expect(ok.body).not.toHaveProperty('error');
  expect(ok.status).toBe(200);
  const body: any = ok.body;
  expect(body.stack[0]).toEqual({ file, lineNumber: 3, column: 2, methodName: 'foo', collapse: false });
  expect(body.stack[1].collapse).toBe(true);
  expect(body.codeFrame.location).toEqual({ row: 3, column: 2 });
  expect(body.codeFrame.content.replace(/\x1b\[[0-9;]*m/g, '')).toContain('> 3 |   throw new Error("x");');

  // not a graph file -> no code frame
  const outside = await symbolicateRequest({ stack: [{ file: url, lineNumber: 5, column: 4 }] }, { ...deps, isGraphFile: () => false });
  expect((outside.body as any).codeFrame).toBeNull();

  // invalid input -> 400 with Metro's message
  const bad = await symbolicateRequest({ x: 1 }, deps);
  expect(bad.status).toBe(400);
  expect((bad.body as any).error).toContain('Bad symbolication input, expected object with stack array');
  const badFrame = await symbolicateRequest({ stack: [{ lineNumber: 'x' }] }, deps);
  expect((badFrame.body as any).error).toBe('Bad frame at line 0: Expected lineNumber to be number or nullish');
});
