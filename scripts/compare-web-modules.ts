// Repo only (CI bundle-determinism): are two web exports' JS bundles the same code, module IDs aside?
//   bun scripts/compare-web-modules.ts <node-export-dir> <bun-export-dir>
// Expo's static web export bundles the server render bundle and the client bundle in parallel and numbers modules
// with one shared ID factory in serialization order, so the IDs (and the bundle hash) depend on which bundle finishes
// first - on Node as well as on Bun (KNOWN-ISSUES #21). Each `__d(factory, id, [dependency ids])` is compared without
// its id and dependencies (`r(d[i])` inside the factory indexes the dependency list, so the code is unaffected;
// async-route chunk paths there carry hashed names too);
// everything outside the module definitions (prelude, polyfills) must be identical up to `__r(<id>)`.
import fs from 'node:fs';
import path from 'node:path';

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: bun scripts/compare-web-modules.ts <dir-a> <dir-b>');
  process.exit(2);
}

const WEB = path.join('_expo', 'static', 'js', 'web');
/** chunk name without its content hash -> file */
function chunks(dir: string) {
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(path.join(dir, WEB))) if (f.endsWith('.js')) out.set(f.replace(/-[0-9a-f]{32}\.js$/, ''), path.join(dir, WEB, f));
  return out;
}

// dependencies: an id list, or (async routes) an object of ids plus `paths` to the route chunks
const DEPS = String.raw`(?:\[[\d,]*\]|\{(?:[^{}]|\{[^{}]*\})*\})`;
const MODULE = new RegExp(String.raw`__d\(function[\s\S]*?\},\d+,${DEPS}(?:,"[^"]*")?\);`, 'g');
const TAIL = new RegExp(String.raw`\},\d+,${DEPS}(,"[^"]*")?\);$`);
function normalize(file: string) {
  const code = fs.readFileSync(file, 'utf8');
  const modules = (code.match(MODULE) ?? []).map((m) => m.replace(TAIL, '}$1);')).sort();
  const rest = code.replace(MODULE, '').replace(/__r\(\d+\)/g, '__r(ID)');
  return { modules, rest };
}

const left = chunks(a);
const right = chunks(b);
let differences = 0;
for (const name of new Set([...left.keys(), ...right.keys()])) {
  const x = left.get(name);
  const y = right.get(name);
  if (!x || !y) {
    differences++;
    console.log(`  only in ${x ? a : b}: ${name}`);
    continue;
  }
  const p = normalize(x);
  const q = normalize(y);
  const sameModules = p.modules.length === q.modules.length && p.modules.every((m, i) => m === q.modules[i]);
  if (!sameModules || p.rest !== q.rest) {
    differences++;
    console.log(`  differs: ${name} (${p.modules.length} vs ${q.modules.length} modules${p.rest !== q.rest ? ', code outside modules differs' : ''})`);
  } else console.log(`  same: ${name} (${p.modules.length} modules)`);
}
console.log(`${differences} difference(s)`);
process.exit(differences ? 1 : 0);
