// Run with `bun test` (bunfig.toml limits `bun test` to tools/; app tests use Jest).
import { describe, expect, test } from 'bun:test';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

import minify from './metro-minifier.js';

const filename = 'src/example.js';

// Identity map: module code -> "original source" with the same text, one segment per line start + names.
function identityMap(code: string) {
  const { encode } = require('@jridgewell/sourcemap-codec');
  const lines = code.split('\n').map((line: string, lineIndex: number) => {
    const segs: number[][] = [];
    const re = /[A-Za-z_$][\w$]*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) segs.push([m.index, 0, lineIndex, m.index]);
    return segs;
  });
  return { version: 3, sources: [filename], names: [], mappings: encode(lines) };
}

const strictModule = `__d(function (global, _$$_REQUIRE, _$$_IMPORT_DEFAULT, _$$_IMPORT_ALL, module, exports, _dependencyMap) {
  "use strict";

  function computeTotalPrice(itemPrice, quantity) {
    const subtotal = itemPrice * quantity;
    return _$$_REQUIRE(_dependencyMap[0]).round(subtotal);
  }
  module.exports = computeTotalPrice;
},42,[7],"src/example.js");`;

const options = (code: string, map?: object) => ({ code, map, filename, reserved: [], config: {} });

describe('metro-minifier (Bun)', () => {
  test('minifies a strict module and keeps the "use strict" directive at the start of the wrapper body', async () => {
    const { code } = await minify(options(strictModule));
    expect(code.startsWith('__d(function(')).toBe(true);
    expect(code).toMatch(/^__d\(function\([^)]*\)\{"use strict";/);
    expect(code.length).toBeLessThan(strictModule.length / 2);
    expect(code).not.toContain('computeTotalPrice');
    expect(code.endsWith(',42,[7],"src/example.js");')).toBe(true);
  });

  test('keeps strict-mode semantics (assignment to an undeclared variable throws)', async () => {
    const mod = `__d(function (g, r, i, a, m, e, d) {
  "use strict";
  m.exports = function assignGlobal() { undeclaredVariable = 1; };
},1,[],"x.js");`;
    const { code } = await minify(options(mod));
    let exported: () => void = () => {};
    const __d = (factory: Function) => {
      const m = { exports: {} as any };
      factory(globalThis, null, null, null, m, m.exports, []);
      exported = m.exports;
    };
    new Function('__d', code)(__d);
    expect(() => exported()).toThrow(ReferenceError);
  });

  test('composes the source map: minified identifiers map back to their original position', async () => {
    const map = identityMap(strictModule);
    const { code, map: out } = await minify(options(strictModule, map));
    expect(out!.sources).toEqual([filename]);
    const tm = new TraceMap(out as any);
    // `.round(` survives minification (property access); its column is after the inserted directive.
    const col = code.indexOf('.round(') + 1;
    const pos = originalPositionFor(tm, { line: 1, column: col });
    const originalLine = strictModule.split('\n')[(pos.line ?? 1) - 1];
    expect(originalLine.slice(pos.column ?? 0, (pos.column ?? 0) + 5)).toBe('round');
  });

  test('falls back to terser for polyfills (not a __d module wrapper)', async () => {
    const polyfill = `(function (global) { "use strict"; global.someLongPolyfillName = function () { return 1; }; })(globalThis);`;
    const { code } = await minify(options(polyfill));
    expect(code).not.toMatch(/\bexport\b/);
    expect(code).toContain('use strict');
  });

  test('falls back to terser when "use strict" appears elsewhere (nested directive)', async () => {
    const mod = `__d(function (g, r, i, a, m, e, d) {
  function inner() { "use strict"; return this; }
  m.exports = inner;
},2,[],"y.js");`;
    const { code } = await minify(options(mod));
    expect(code).toContain('"use strict"');
  });
});
