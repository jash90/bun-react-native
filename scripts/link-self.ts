// Repo only (example/ postinstall, not in the package): the example app resolves `bun-react-native` (bunfig preload, config plugin, CLI) to
// this checkout, like a project that installed the package - node_modules/bun-react-native -> repo root and its bins.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
if (fs.existsSync(path.join(root, 'example', 'package.json'))) {
  const link = (target: string, at: string) => {
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.rmSync(at, { force: true, recursive: true });
    fs.symlinkSync(path.relative(path.dirname(at), target), at);
  };
  link(root, path.join(root, 'node_modules', 'bun-react-native'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const [name, file] of Object.entries<string>(pkg.bin)) {
    fs.chmodSync(path.join(root, file), 0o755);
    link(path.join(root, file), path.join(root, 'node_modules', '.bin', name));
  }
}
