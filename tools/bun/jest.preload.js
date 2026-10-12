// Jest enables its ESM code path when vm.SyntheticModule exists (Node only exposes it with
// --experimental-vm-modules; Bun always does). Hide it in Jest processes (CLI + jest-worker children)
// so Jest under Bun behaves like under Node.
if (process.versions.bun && /[\\/]jest[^\\/]*[\\/]|[\\/]\.bin[\\/]jest$/.test(process.argv[1] || '')) {
  const vm = require('vm');
  delete vm.SyntheticModule;
  delete vm.SourceTextModule;
}
