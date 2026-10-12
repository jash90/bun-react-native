// Compare an `expo export` (Metro) output directory with a Bun bundler one:
//   bunx bun-react-native compare <metro-dir> <bun-dir>   (RN_BUNDLER=bun expo export vs expo export)
// Both must have the same file set and identical files. The JS bundles themselves differ by design (another
// bundler), so `entry-<hash>` names are normalized and bundle files are only checked for existence; HTML,
// metadata.json and server manifests are compared with those names normalized. Exit code 1 on any difference.
// Run Metro with its own TMPDIR (`TMPDIR=/tmp/x bun expo export ...`) so its cache does not mix with other runs.
import fs from 'node:fs';
import path from 'node:path';

const [metroDir, bunDir] = process.argv.slice(2);
if (!metroDir || !bunDir) {
  console.error('usage: bun-react-native compare <metro-dir> <bun-dir>');
  process.exit(2);
}

const BUNDLE = /(^|\/)_expo\/static\/js\/.*\.(js|hbc|map)$/;
const HASHED = /(entry|index|_layout|\+html)-[0-9a-f]{32}/g;
// API routes / server functions are bundled code too
const SERVER_CODE = /^server\/.*\.js(\.map)?$/;

/** normalized relative path -> real relative path */
function list(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(dir, { recursive: true }).map(String)) {
    if (!fs.statSync(path.join(dir, f)).isFile()) continue;
    const rel = f.split(path.sep).join('/');
    out.set(rel.replace(HASHED, '$1-X'), rel);
  }
  return out;
}

const metroFiles = list(metroDir);
const bunFiles = list(bunDir);
let differences = 0;
for (const f of [...metroFiles.keys()].sort()) {
  const bunFile = bunFiles.get(f);
  if (!bunFile) (differences++, console.log(`  only in Metro: ${f}`));
  if (!bunFile || BUNDLE.test(f) || SERVER_CODE.test(f)) continue;
  const a = fs.readFileSync(path.join(metroDir, metroFiles.get(f)!));
  const b = fs.readFileSync(path.join(bunDir, bunFile));
  const textual = /\.(html|json)$/.test(f);
  const same = textual ? a.toString().replace(HASHED, '$1-X') === b.toString().replace(HASHED, '$1-X') : a.equals(b);
  if (!same) (differences++, console.log(`  differs: ${f}`));
}
for (const f of [...bunFiles.keys()].sort()) if (!metroFiles.has(f)) (differences++, console.log(`  only in Bun:   ${f}`));

console.log(`${bunDir}: ${metroFiles.size} files (Metro), ${bunFiles.size} (Bun), ${differences} difference(s)`);
process.exit(differences ? 1 : 0);
