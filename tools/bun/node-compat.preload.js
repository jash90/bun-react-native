// Workaround for oven-sh/bun#44947: Node (libuv scandir) returns directory entries sorted,
// Bun returns filesystem order. Metro's asset resolution depends on that order.
if (process.versions.bun) {
  const fs = require('fs');
  const byName = (a, b) => {
    const x = typeof a === 'string' ? a : Buffer.isBuffer(a) ? a.toString() : a.name;
    const y = typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString() : b.name;
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const sortResult = (r) => (Array.isArray(r) ? r.sort(byName) : r);
  const origSync = fs.readdirSync;
  fs.readdirSync = function (...args) { return sortResult(origSync.apply(this, args)); };
  const orig = fs.readdir;
  fs.readdir = function (...args) {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') return orig.apply(this, args);
    args[args.length - 1] = (err, res) => cb(err, err ? res : sortResult(res));
    return orig.apply(this, args);
  };
  const origP = fs.promises.readdir;
  fs.promises.readdir = async function (...args) { return sortResult(await origP.apply(this, args)); };
}
