// Metro minifier backed by Bun's native minifier (Bun.build on an in-memory file).
// Wired in metro.config.js as `transformer.minifierPath` when Metro runs on Bun.
//
// Contract (same as metro-minify-terser): ({ code, map, filename, reserved, config }) => { code, map? }.
// `code` is one Metro module (`__d(function (g, r, i, a, m, e, d) { ... })`), `map` maps it back to the source.
//
// Falls back to metro-minify-terser when not running on Bun, when Bun fails, or when the module cannot be
// minified with exactly the same semantics:
// - Bun drops function-level "use strict" directives. The wrapper's directive is re-inserted at the start of the
//   minified wrapper body and the source map columns after it are shifted accordingly.
//   Any other "use strict" occurrence (nested directive or string) -> terser.
// - Only Metro module wrappers (`__d(function ...)`) are handled. Polyfills and the prelude are scripts; Bun treats
//   its input as an ES module and may add `export` statements, which Hermes rejects in script mode.
//   The output must still be exactly one `__d(function(...){...}, ...);` call.
// - `reserved` (Metro's renamed pseudo-globals) cannot be passed to Bun; renaming wrapper parameters is local to
//   the module function and does not change behaviour.
const terserMinifier = require('metro-minify-terser');
const remapping = require('@jridgewell/remapping');
const { decode, encode } = require('@jridgewell/sourcemap-codec');

const VIRTUAL = '/__metro_bun_minifier__/module.js';
const USE_STRICT_ALL_RE = /(['"])use strict\1/g;
const USE_STRICT_RE = /(['"])use strict\1/;
const DIRECTIVE = '"use strict";';
const WRAPPER_DIRECTIVE_RE = /^__d\(function\s*\([^)]*\)\s*\{\s*(['"])use strict\1/;
const MINIFIED_WRAPPER_OPEN_RE = /^__d\(function\([^)]*\)\{/;
const MODULE_WRAPPER_RE = /^__d\(function\s*\(/;
const scanner = process.versions.bun ? new Bun.Transpiler({ loader: 'js' }) : null;
const DEBUG_ID_RE = /\n?\/\/# debugId=[0-9A-Fa-f-]+\s*$/;

let stats = null;
if (process.env.METRO_BUN_MINIFIER_STATS) {
  stats = { bun: 0, terser: 0, reasons: {} };
  process.on('exit', () => {
    console.error(`[metro-bun-minifier] pid=${process.pid} ${JSON.stringify(stats)}`);
  });
}

function fallback(options, reason) {
  if (stats) {
    stats.terser++;
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
  }
  return terserMinifier(options);
}

async function bunMinifier(options) {
  if (!process.versions.bun) return fallback(options, 'not-bun');
  const { code, map, filename } = options;
  if (!MODULE_WRAPPER_RE.test(code)) return fallback(options, 'not-a-module-wrapper');

  const directives = code.match(USE_STRICT_ALL_RE)?.length ?? 0;
  const wrapperStrict = WRAPPER_DIRECTIVE_RE.test(code);
  if (directives > (wrapperStrict ? 1 : 0)) return fallback(options, 'use-strict-elsewhere');

  let result;
  try {
    result = await Bun.build({
      entrypoints: [VIRTUAL],
      files: { [VIRTUAL]: code },
      minify: true,
      target: 'browser',
      format: 'esm',
      sourcemap: map ? 'external' : 'none',
    });
  } catch {
    return fallback(options, 'bun-build-threw');
  }
  if (!result.success) return fallback(options, 'bun-build-failed');

  const js = result.outputs.find((o) => o.kind === 'entry-point');
  let out = (await js.text()).replace(DEBUG_ID_RE, '').replace(/\n+$/, '');

  if (USE_STRICT_RE.test(out)) return fallback(options, 'unexpected-directive-in-output');
  if (!MINIFIED_WRAPPER_OPEN_RE.test(out) || !out.endsWith(');')) return fallback(options, 'unexpected-output-shape');
  const scanned = scanner.scan(out);
  if (scanned.exports.length || scanned.imports.length) return fallback(options, 'module-syntax-in-output');

  let insertAt = -1;
  if (wrapperStrict) {
    const open = out.match(MINIFIED_WRAPPER_OPEN_RE);
    if (!open) return fallback(options, 'unexpected-wrapper-shape');
    insertAt = open[0].length;
    out = out.slice(0, insertAt) + DIRECTIVE + out.slice(insertAt);
  }

  if (stats) stats.bun++;
  if (!map) return { code: out };

  const bunMap = JSON.parse(await result.outputs.find((o) => o.kind === 'sourcemap').text());
  if (insertAt >= 0) {
    // The wrapper opening is on the first generated line; shift every segment after the inserted directive.
    const lines = decode(bunMap.mappings);
    lines[0] = lines[0].map((seg) => (seg[0] >= insertAt ? [seg[0] + DIRECTIVE.length, ...seg.slice(1)] : seg));
    bunMap.mappings = encode(lines);
  }
  // bunMap: minified -> module code; map: module code -> original source. Compose to minified -> original.
  const composed = remapping([bunMap, map], () => null, { excludeContent: true });
  return {
    code: out,
    map: { ...composed, sources: [filename] },
  };
}

module.exports = bunMinifier;
module.exports.default = bunMinifier;
