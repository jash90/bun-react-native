// Node behaviours Metro / Expo depend on that Bun does differently (docs/bun-react-native/KNOWN-ISSUES.md):
//   #4  fs.readdir*: Node (libuv scandir) returns directory entries sorted, Bun filesystem order (oven-sh/bun#44947)
//       - Metro's asset resolution depends on that order
//   #18 util.parseEnv: Node returns the keys sorted (a std::map, byte order), Bun in file order - @expo/env parses
//       .env files with it, so the order of EXPO_PUBLIC_* variables in development bundles depends on it
//   #19 net.Server#listen(port, host, undefined, cb): Bun never calls cb (oven-sh/bun#45090) - Metro's runServer
//       (earlyPortCheck) calls it like that, so `react-native start` never finishes starting
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
  const net = require('net');
  const origListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    // drop undefined arguments before a trailing callback, as Node's argument normalisation does
    if (typeof args[args.length - 1] === 'function') {
      const cb = args.pop();
      while (args.length && args[args.length - 1] === undefined) args.pop();
      args.push(cb);
    }
    return origListen.apply(this, args);
  };
  const util = require('util');
  const origParseEnv = util.parseEnv;
  if (typeof origParseEnv === 'function') {
    util.parseEnv = function parseEnv(content) {
      const parsed = origParseEnv.call(this, content);
      const out = {};
      for (const key of Object.keys(parsed).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) out[key] = parsed[key];
      return out;
    };
  }
}
