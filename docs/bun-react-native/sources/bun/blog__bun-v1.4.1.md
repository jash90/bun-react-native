---
source: https://bun.com/blog/bun-v1.4.1 (markdown: https://bun.com/blog/bun-v1.4.1.md)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504 (docs repo HEAD at fetch time; blog posts are not in oven-sh/bun, fetched from bun.com)
---

# Bun v1.4.1

> Fixes 202 issues, addressing 236 👍. HTTP/2 in Bun.serve, Bun.write() streams Response bodies to disk, self-contained workspace node_modules, bun install --offline and --prefer-offline, WebSocket pause() and resume(), crypto.argon2, tree-shaking through dynamic import(), smarter CommonJS to ESM conversion for default imports, --compile --bytecode when cross-compiling, smaller and faster-starting compiled executables, up to 9x faster Buffer reads and writes, 2x faster AsyncLocalStorage, faster startup, and many bugfixes and Node.js compatibility improvements.

_Excerpt: kept whole sections on Node.js compatibility, bun install, bun test, upgrading/breaking changes, developer experience/processes, plus any subsection mentioning install/linker/lockfile/trustedDependencies/node_modules/workers/fs.watch/argv/preload/bunfig/BUN_OPTIONS/child_process/jest/mocks. Full verbatim post: see blog-full/ in this directory._


Bun v1.4.1 fixes 202 issues, addressing 236 👍.

#### To install Bun

{% codetabs %}

```sh#curl
$ curl -fsSL https://bun.sh/install | bash
```

```sh#npm
$ npm install -g bun
```

```sh#powershell
$ powershell -c "irm bun.sh/install.ps1|iex"
```

```sh#scoop
$ scoop install bun
```

```sh#brew
$ brew tap oven-sh/bun
$ brew install bun
```

```sh#docker
$ docker pull oven/bun
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun
```

{% /codetabs %}

#### To upgrade Bun

```sh
$ bun upgrade
```

## New in the runtime

_(parent section; only matching subsections kept)_

### `require()` is faster for built-in Node.js modules

`node:fs`, `node:assert`, `node:util`, `node:vm`, `node:http` and a few others load their internals on first use instead of at `require()` time.

| Module                | Bun v1.4.1 | Bun v1.4.0 |
| --------------------- | ---------: | ---------: |
| `node:assert`         |    0.64 ms |    6.22 ms |
| `node:https`          |    4.77 ms |    8.14 ms |
| `node:http`           |    4.72 ms |    7.44 ms |
| `node:vm`             |    0.55 ms |    2.57 ms |
| `node:fs`             |    0.87 ms |    2.75 ms |
| `node:util`           |    1.02 ms |    2.32 ms |
| `node:tty`            |    3.25 ms |    4.35 ms |
| `node:worker_threads` |    1.42 ms |    2.43 ms |
| `node:http2`          |    6.87 ms |    7.58 ms |
| `node:child_process`  |    1.15 ms |    1.59 ms |

<!-- https://github.com/oven-sh/bun/commit/a5e30c96d96c6294222aef79d5b5ace57d015e11 -->

### Upgraded JavaScriptCore

Bun's JavaScriptCore includes about 400 upstream WebKit commits. They include fixes for JIT miscompiles and for crashes on deeply nested destructuring patterns.

```ts
await import("./flaky.ts").catch(() => {});
await import("./flaky.ts"); // retries the load instead of rejecting with the cached error
```

- `Promise.try` follows the updated spec.
- `WebAssembly.Module.imports()` and `exports()` descriptors no longer include the non-standard `type` field.

<!-- https://github.com/oven-sh/bun/commit/11fb73032c91b4099691279b02852a9c9491e036 -->

## New in `bun install`

### Self-contained `node_modules` for workspace packages

Workspace packages listed under `"selfContained"` in the `"workspaces"` object of package.json get a self-contained `node_modules`. This is for tools that expect a specific `node_modules` layout, such as Electron.

```json#package.json
{
  "workspaces": {
    "packages": ["apps/*"],
    "selfContained": ["apps/desktop"]
  }
}
```

Yarn's `"installConfig": { "hoistingLimits": "workspaces" }` in the workspace's own package.json works too.

<!-- https://github.com/oven-sh/bun/commit/57b61eb8f37aac70e3088ccaf2fc3bc6e50cd052 -->

### `bun install --offline`

`bun install --offline` makes no network requests. Every package must already be in Bun's cache. It is intended for CI jobs that restore a cache and for machines without network access.

```sh
bun install --offline
```

To make it the default, set it in `bunfig.toml`:

```toml#bunfig.toml
[install]
offline = true
```

A package missing from the cache is an error that names it:

```
error: --offline: no cached manifest for "left-pad"
(run once online, or use --prefer-offline)
```

### `bun install --prefer-offline`

By default, `bun install` checks for newer versions by re-fetching a package's metadata once the cached copy expires. `--prefer-offline` skips that check and uses the cached copy regardless of age. Packages that are not in the cache are still downloaded.

```sh
bun install --prefer-offline
```

To make it the default, set it in `bunfig.toml`:

```toml#bunfig.toml
[install]
prefer = "offline"
```

<!-- https://github.com/oven-sh/bun/commit/bbf3f4af32c4f40c937f1a567ffdc63edbb21233 -->

## New in `bun build`

_(parent section; only matching subsections kept)_

### Smaller bundles for libraries that use `export * as`

Libraries like zod and Effect group their exports with `export * as`. When a program called `z.object()`, Bun 1.4.0 kept every export of that group. It built a namespace object with a getter for each one. Bun 1.4.1 compiles `z.object` to a direct reference to the `object` function, and unused exports are tree-shaken.

```js-diff#out.js
- var User = exports_external.object({ a: exports_external.string() });
+ var User = object({ a: string2() });
```

Each program below calls two or three functions from one library, built with `bun build --minify`:

| Package                  | Bun 1.4.0 | Bun 1.4.1 | Change |
| ------------------------ | --------: | --------: | -----: |
| `fp-ts` 2.16             |   21.8 KB |    3.2 KB |   −85% |
| `zod` 4.5                |  375.3 KB |   77.3 KB |   −79% |
| `ox` 1.7                 |   15.4 KB |    4.7 KB |   −70% |
| `effect` 3.22            |  369.1 KB |  163.6 KB |   −56% |
| `@sinclair/typebox` 0.34 |  107.1 KB |   53.3 KB |   −50% |

In the zod bundle, Bun 1.4.0 kept this object with 252 entries:

```js#Bun_1.4.0_output
var exports_external = {};
__export(exports_external, {
  $brand: () => $brand,
  NEVER: () => NEVER,
  ZodAny: () => ZodAny,
  // ...249 more
});
```

Every entry kept its export in the bundle, including `ZodDiscriminatedUnion`, `ZodRecord`, `ZodTemplateLiteral`, the JSON Schema generator, and 62 locale files. Bun 1.4.1 removes all of them.

The namespace objects that are still generated accept assignment, which a real module namespace does not. To make them getter-only so that assigning throws, set `deprecatedNamespaceObjectSetters: false` or pass `--no-deprecated-namespace-object-setters`. This will be the default in a future release.

<!-- https://github.com/oven-sh/bun/commit/e8eaae9fe644b69db9b49fba25efc36d885e85b5 -->

### Tree-shaking through dynamic `import()`

`bun build` now removes the exports of a dynamically imported module that the importing code never reads.

```ts#main.ts
// is.ts exports isNumber, isOdd, and isEven
const { isOdd } = await import("./is");
console.log(isOdd(3));
```

With `bun build ./main.ts --splitting --outdir dist`, `is.ts` becomes its own chunk:

```js-diff#dist/is-1qza7reb.js
  function isNumber(n) {
    return typeof n === "number";
  }
  function isOdd(n) {
    return isNumber(n) && n % 2 === 1;
  }
- function isEven(n) {
-   return !isOdd(n);
- }
  export {
-   isEven,
-   isNumber,
    isOdd
  };
```

If the namespace escapes (passed to a function, spread, `Object.keys(ns)`, computed access), every export is kept.

This also works without `--splitting` when every use of the `import()` result reads a named export. `const { z } = await import("zod")` bundles the same code as `import { z } from "zod"`.

```sh
$ bun build ./main.ts --minify --outfile=out.js
# zod 4.5      377.9 KB -> 78.2 KB
# effect 3.22  248.1 KB -> 125.7 KB
```

The same applies to `require()` of an ES module. A CommonJS module keeps every export.

<!-- https://github.com/oven-sh/bun/commit/e5154cd10e2e3093ef2ad262645983afb0031a1e -->
<!-- https://github.com/oven-sh/bun/commit/b0cf0f40e7f103a3c247e9b7a7b5b0b199da5638 -->

### Module preloading for code-split browser builds

With `--splitting` and `--target browser`, Bun adds `<link rel="modulepreload">` for the chunks your code needs, so the browser fetches them in parallel.

```sh
bun build ./index.html --splitting --outdir dist
```

HTML entrypoints get a `<link rel="modulepreload">` for every chunk their script imports:

```html-diff#dist/index.html
  <head>
    <script type="module" crossorigin src="./index-9tft256y.js"></script>
+   <link rel="modulepreload" crossorigin href="./index-60vtcrm3.js">
  </head>
```

{% raw %}

<video autoplay loop muted playsinline width="1920" height="1080" poster="/images/bun-modulepreload-1.4.1-poster.webp" class="my-7 block h-auto w-full md:rounded-xl" aria-label="Bun 1.4.0, without modulepreload, loads index.html, index.js, chunk-a.js, and chunk-b.js in three round trips. Bun 1.4.1, with link rel=modulepreload, loads them in two.">
  <source src="/images/bun-modulepreload-1.4.1.mp4" type="video/mp4" />
</video>

{% /raw %}

A lazy `import()` now also preloads the chunks that its target imports. In the example below, `settings-msmf5hdm.js` imports two chunks. `__preload` adds a `<link rel="modulepreload">` for each of them, so the browser fetches them in parallel with `settings-msmf5hdm.js`. Previously, the browser found those two chunks only after `settings-msmf5hdm.js` had loaded and been parsed. That took a second round trip.

```js-diff#dist/index-9tft256y.js
- const { settings } = await import("./settings-msmf5hdm.js");
+ const { settings } = await (__preload("msmf5hdm"), import("./settings-msmf5hdm.js"));
  // preloads index-60vtcrm3.js and index-0fxtmqn2.js
```

An `import()` inside a lazily loaded chunk gets the same `__preload`. Previously, the browser discovered each chunk only after the previous one loaded. This added one round trip per level.

This is on by default. To turn it off, set `modulePreload: false` in `Bun.build` or pass `--no-module-preload`.

<!-- https://github.com/oven-sh/bun/commit/7c18e0d0a84c7426b73faf1ebc62348155ea650a -->

### Smarter CommonJS to ESM conversion for default imports

When you `import pkg from "pkg"` and `pkg` is CommonJS, `bun build` now tries to compile `pkg.foo` to a plain top-level variable instead of a property read on a wrapper object. It does this when it can see every export the module assigns, which covers packages like `react`, `react-dom`, and `scheduler`.

Previously, this was only supported for `import * as pkg from 'pkg'` or named imports, now it also is supported on default imports - and several bugs fixed along the way.

```js#in.js
import React from "react";
const el = React.createElement("div");
```

```js-diff#out.js
- var import_react = __toESM(require_react());
- var el = import_react.default.createElement("div");
+ var el = $createElement("div");
```

```sh
# import React + React.createElement("div"), react@19, --production --minify
8,206 -> 1,392 bytes
```

The same conversion now also applies through `module.exports = require("./impl")` redirect files such as `react-dom/index.js`. Bun falls back to the wrapper when it cannot prove the conversion is safe: the module assigns `module.exports` dynamically, assigns both `module.exports` and `exports.foo`, reads `module` for anything other than `module.exports`, or is external.

<!-- https://github.com/oven-sh/bun/commit/d6af50f4f0b5c47b0236628a6e9785502a654dd1 -->

### Smaller code-split bundles

`bun build --splitting --minify` assigns each binding shared between chunks a single bundle-wide name. Chunks no longer rename imports and exports.

```js
// before
import { Qc as ur } from "./chunk-a.js";
// after
import { a } from "./chunk-a.js";
```

On a 100-route app with 600 shared modules, minified output went from 421 KB to 340 KB (19% smaller, and 18.7% smaller gzipped).

<!-- https://github.com/oven-sh/bun/commit/731aa92dad3777448920b40a4c2d3efe7e776c4e -->

## New in `bun test`

### `bun test --isolate` no longer leaks between files

Test files that call `mock()`, `spyOn()`, `mock.module()`, or `Bun.plugin()` no longer keep their module graph alive after they finish. Memory under `--isolate` now stays flat as files run.

```sh
bun test --isolate   # 80 files with mocks: 1591 MB -> 215 MB, 1.95s -> 1.46s
```

- `process.env.TZ`, proxy, and TLS settings no longer carry into later test files.
- A file that leaves `monitorEventLoopDelay()` enabled no longer crashes the run.

<!-- https://github.com/oven-sh/bun/commit/8d5689d086c08073f1fdca19d958b48fa2cd35e5 -->

## Bugfixes

_(parent section; only matching subsections kept)_

### Node.js compatibility improvements

- Fixed: `node:http` servers mishandled requests with an empty `Transfer-Encoding` header, unlike Node.
  - Emitted a spurious `clientError` after serving the request, so a typical handler destroyed the connection.
  - Rejected the request when `Content-Length` was also set, instead of reading the body by `Content-Length`.

<!-- https://github.com/oven-sh/bun/commit/36cddd82a1b97026cae854828505374e498ea5a3 -->

- Fixed: `node:http` responses emitted `'close'` before `'finish'` when `res.destroy()` followed `res.end()`.

<!-- https://github.com/oven-sh/bun/commit/46a6c3927852a5e170438b7c8be6de77cc65424b -->

- Fixed: `node:http` sent non-ASCII header values as UTF-8 instead of latin-1 when the string came from `TextDecoder`, `JSON.parse()`, or `normalize()`.

<!-- https://github.com/oven-sh/bun/commit/49b74a33af5badeb231d3254063da6947901becc -->

- Fixed: `http.Server.listen(port, cb)` never called `cb` when retried from an `EADDRINUSE` error handler. This made vite's port auto-increment hang.

<!-- https://github.com/oven-sh/bun/commit/bfa75d1bf86b4d5183ddc61aa94e83280ad7e986 -->

- Fixed: `undici.request()` rejected a `node:stream` `Readable` body. It now streams it.

- Improved: `readline.createInterface()` no longer loads `node:fs`, `node:util`, or `node:vm` (58 to 41 internal modules).

<!-- https://github.com/oven-sh/bun/commit/333e502aea7fc9a4b5b2490fd35ca0c98f492536 -->

- Improved: `server.listen()` no longer loads `node:cluster` in the primary process.

<!-- https://github.com/oven-sh/bun/commit/593b4fee7d94cd18a63dedd776cd32d0fa0bb6ef -->

- Fixed: several `node:http2` server and client differences from Node.js.
  - `Http2SecureServer` lacked `closeIdleConnections()`, breaking Fastify's `forceCloseConnections: "idle"` option.
  - `session.server` was `undefined` on server sessions, unlike Node.js.
  - Client `session.destroy(undefined, code)` put `code` in the GOAWAY frame, so the peer saw an error instead of a clean close.
  - Incoming header values with bytes that are not valid UTF-8 became `�` instead of being read as latin-1 like Node.

<!-- https://github.com/oven-sh/bun/commit/05921d5829dacce759513e7c887c8b3f550fddd2 -->

- Fixed: several `node:http2` interoperability issues that could make gRPC calls fail against `@grpc/grpc-js`, grpc-go, and nghttp2 peers, and that garbled non-ASCII header values sent to Node.js. `session.altsvc()` now passes `origin` through unchanged, like Node.js.

<!-- https://github.com/oven-sh/bun/commit/b36143acb4d71bad1e42fe900517eaf6ca0004f8 -->

- Fixed: `net.createServer(cb)` did not register `cb` as a `"connection"` listener, breaking Mockttp.

<!-- https://github.com/oven-sh/bun/commit/81801cc1d03bf9f86fc93efe4738528561e871f5 -->

- Fixed: a regression in 1.4.0 where the process exited before a `net.Socket` connected if `unref()` or `pause()` was called first, breaking `testcontainers`.

<!-- https://github.com/oven-sh/bun/commit/d9dae746f3f43974b3b4ef79cca070b3694dca12 -->

- Fixed: a paused `net.Socket` or `TLSSocket` never emitted `'end'` when the peer closed the connection, so `server.close()` hung.

<!-- https://github.com/oven-sh/bun/commit/e54bbfa70c258c6759fa0d3aad5b2db33fb0a3f6 -->

- Fixed: `tls.getCACertificates('system')` returned each root certificate 5-6 times on Linux distros that link several CA bundle paths to one file.

<!-- https://github.com/oven-sh/bun/commit/02031c70bf5bd0e4ff42bd1cf8b252d51607c8a5 -->

- Fixed: HTTPS requests through a SOCKS5 proxy with `undici` left one proxy tunnel open per request, unlike Node.

<!-- https://github.com/oven-sh/bun/commit/683d304e921beaf07b8130232e67bc71dec52751 -->

- Fixed: a TLS 1.3 `tls.connect()` client whose certificate the server rejected got `ECONNRESET` instead of a clean close.

<!-- https://github.com/oven-sh/bun/commit/6d9577b8e35f6c735d8e6fa55f249dd0fd5e1ce8 -->

- Fixed: a `node:tls` write waiting on backpressure failed with `ERR_SOCKET_CLOSED` when the peer half-closed cleanly, which dropped AWS SDK requests.

<!-- https://github.com/oven-sh/bun/commit/bdf4738d8c08e4b4fac02a181e2c4c966a486d5d -->

- Fixed: recursive `fs.promises.readdir()` could hang forever on a tree with directory symlink loops and an entry that fails to open.

<!-- https://github.com/oven-sh/bun/commit/09559edd5298b574919b5c4c3cd43a455e768d46 -->

- Fixed: async `node:fs` calls given a `Buffer` path could leak the `Buffer`

<!-- https://github.com/oven-sh/bun/commit/0e395c2459e645e57a663384677057c049ea36b4 -->

- Fixed: recursive `fs.readdirSync()` and `fs.promises.readdir()` threw `ENOENT` when another process removed a subdirectory during the walk.

<!-- https://github.com/oven-sh/bun/commit/1963439749c9160573a3db3a458df7cde94314f1 -->

- Fixed: `fs.truncateSync(path, undefined)` and `fs.ftruncateSync(fd, undefined)` threw instead of truncating to 0.

<!-- https://github.com/oven-sh/bun/commit/4c815c11a54d40e990c53e799281222583ecb9ba -->

- Fixed: `fs.ReadStream` and `fs.WriteStream` threw after `Object.freeze(require("node:fs"))`.

<!-- https://github.com/oven-sh/bun/commit/72ec6e2594892455df009072eb8034d93d510d75 -->

- Fixed: `node:fs` callback APIs threw `ENAMETOOLONG` synchronously for a path over the OS length limit, instead of passing it to the callback.

<!-- https://github.com/oven-sh/bun/commit/83350172b9f9ab25988782715b5adfb1c9544d13 -->

- Fixed: a regression in 1.4.0 where `fs.rmdir(path, { recursive: true })` threw instead of removing the directory, impacting packages like `@prisma/client`

<!-- https://github.com/oven-sh/bun/commit/fff3b29d6cb9cf7136d4a195c2174554ba44893f -->

- Fixed: two argument-handling bugs in `crypto.sign()` and `crypto.verify()`.
  - `crypto.sign(null, data, ecKey)` threw `NO_DEFAULT_DIGEST` instead of defaulting to SHA-256.
  - Valid `saltLength` or `padding` values were rejected when the number was stored as a double, such as one from `JSON.parse()`.

<!-- https://github.com/oven-sh/bun/commit/365fde21568a58b2939bfed5e9051bd8ddfd658d -->

- Fixed: reading `X509Certificate.publicKey` a second time crashed on a certificate whose key could not be decoded.

<!-- https://github.com/oven-sh/bun/commit/aeb1905d0a1d4890d07be72aba32075a867545cf -->

- Fixed: `setTimeout[util.promisify.custom]` was missing until `node:util` was loaded.

<!-- https://github.com/oven-sh/bun/commit/a1f2e221401da57e98daebb9fb2cca0698dadda4 -->

- Fixed: `util.formatWithOptions()` accepted a function as options. It now throws, like Node.

<!-- https://github.com/oven-sh/bun/commit/a21f02a9883a82f777348bc716f5d5683de6c2ab -->

- Fixed: `util.parseEnv()` and `process.loadEnvFile()` stored numeric keys like `0=zero` so that `result[0]` was `undefined`.

<!-- https://github.com/oven-sh/bun/commit/ce9336128d547eb300e556f8917a37afa406ca51 -->

- Fixed: `assert` failure diffs garbled non-ASCII text, printing `�` for latin-1 characters or lists of numbers for emoji and CJK.

<!-- https://github.com/oven-sh/bun/commit/300f3a0b2982e9c8e811fa471120305995ace955 -->

- Fixed: a regression in 1.4.0 where `assert.deepStrictEqual()` threw for objects with different prototypes, like `Object.create({ x: 1 })` and `{}`.

<!-- https://github.com/oven-sh/bun/commit/a73ed2720f8770216684d0e454d6cc76bd53d037 -->

- Fixed: `dns.lookup()` on macOS failed for some hostnames.
  - A regression in 1.4.0: hostnames served by a VPN, split-DNS, or `/etc/resolver` returned `ENOTFOUND` instead of resolving.
  - Names that are not valid hostnames, such as names containing a space, could wait for a 30 second timeout instead of failing with `ENOTFOUND`.

<!-- https://github.com/oven-sh/bun/commit/4289e3f1b53bac01916b6136a18a289845135022 -->

- Fixed: `dns.resolve(host, "NAPTR")` threw `ERR_INVALID_ARG_VALUE` instead of running a NAPTR query.

<!-- https://github.com/oven-sh/bun/commit/68b42d9b9091eebde94dda69ebe398c6eac00d89 -->

- Fixed: `vitest --coverage` and `c8` could hit "Maximum call stack size exceeded" merging `node:inspector` coverage from modules with `export function` declarations.

<!-- https://github.com/oven-sh/bun/commit/40728404f60dcad4cc30fc93869214d11278e349 -->

- Fixed: the `pprof` package failed on `pprof.time.profile()` with an undefined `CpuProfiler::StartProfiling` symbol.

<!-- https://github.com/oven-sh/bun/commit/422a189fd1f749444f692dbfb669e0a956b85316 -->

- Fixed: when a child process exited before reading all of its stdin, the `EPIPE` error reported `syscall: "send"` instead of `"write"` like Node.

<!-- https://github.com/oven-sh/bun/commit/118fdd203a7e39ee4c64db6d974f79fba139d051 -->

- Fixed: `process.kill(process.pid, "SIGABRT")` printed a Bun crash report instead of exiting silently.

<!-- https://github.com/oven-sh/bun/commit/c6461038060b1b50e5fcb2db0b35d600ec03a46a -->

- Fixed: when memory ran out, `buffer.toString()` and `StringDecoder` threw `ERR_STRING_TOO_LONG` instead of Node's `ERR_MEMORY_ALLOCATION_FAILED`.

<!-- https://github.com/oven-sh/bun/commit/849144384c53c4467f67358f1c8365e758535811 -->

- Fixed: a regression in 1.4.0 where `new Worker()` from `node:worker_threads` threw `port.on is not a function` when a library like happy-dom replaced `globalThis.MessagePort`.

<!-- https://github.com/oven-sh/bun/commit/b746c078b67893036883462bcfc2e950fa8a3f01 -->

- Fixed: an overridden `Module._resolveFilename` got wrong `parent`, `isMain`, and `options` arguments, breaking proxyquire-style tools.

<!-- https://github.com/oven-sh/bun/commit/d77b4bdae90a716e1700e4269e42f16ea1c5575b -->

- Fixed: after an `import` of a builtin like `https`, `require.cache` exposed its frozen module. This crashed dd-trace with OpenTelemetry.

<!-- https://github.com/oven-sh/bun/commit/e0ead955399c5be0707ed839b4b98454a4063a44 -->

- Fixed: several rare N-API addon crashes in finalizers and on `process.exit()`.
  - On the main thread, `process.exit()` previously ran addon finalizers and cleanup hooks, and these could crash. It now skips them, as Node does.
  - `process.exit()` with calls still queued on a threadsafe function no longer passes a null `env` to the addon's callback.
  - A finalizer could still run after `napi_delete_reference` and crash on freed memory.

<!-- https://github.com/oven-sh/bun/commit/28a206b3bed3260176d46534d9a0f86840e6d2e4 -->

- Fixed: `better-sqlite3@13` aborted the process with a `NAPI FATAL ERROR` on load.

<!-- https://github.com/oven-sh/bun/commit/f8d486af9968899e75d20a519a090488267dde64 -->

- Fixed: transferring an N-API external buffer to a Worker could free memory in use.

<!-- https://github.com/oven-sh/bun/commit/fc131921fc19a591a24f41eeedc8319ee8d72e20 -->

- Fixed: on macOS, `node:fs` calls such as `open` and `readdir` could throw `EINTR: interrupted system call` when a signal arrived mid-syscall, instead of retrying like Node.js.

<!-- https://github.com/oven-sh/bun/commit/e0a2b82fd135a9f775c0b4dbf6eba772fbd12a28 -->

### Runtime

- Fixed: `import()` of a file mixing `import` and `module.exports` threw a confusing `SyntaxError`.

<!-- https://github.com/oven-sh/bun/commit/4dd058848d4b3e0d7b58273f64187df965355bed -->

- Fixed: `require()` of a `.ts` file, or running it directly, failed with "Cannot use import statement" when a type-only import was in the same file as `module.exports`.

<!-- https://github.com/oven-sh/bun/commit/81d86633fca5c910c25c710743883477df6b42f7 -->

- Fixed: `import()` crashed after a user-defined getter on `process` or `Bun` loaded an ES module with `require()` and then threw.

<!-- https://github.com/oven-sh/bun/commit/ca38ecfd008ccb31900d5ed129614021dfa39865 -->

- Fixed: a Worker leaked 12 KB on exit when its entry point used a package.json `imports` or `exports` map.

<!-- https://github.com/oven-sh/bun/commit/0d4a604401df7d3d33a70d9f69c887e2b906e8a0 -->

- Fixed: reading `error.stack` leaked memory when running `bun build --sourcemap` output that has an external `.map` file.

<!-- https://github.com/oven-sh/bun/commit/288697e78aec90abc545372669eb7ae311a82db3 -->

- Fixed: memory leaks of strings in module loading, HMR, and several native APIs.

<!-- https://github.com/oven-sh/bun/commit/bc713f95436388e0f8254c8088d2f9ddbdb5c38f -->

- Fixed: in rare cases, `structuredClone()` and `postMessage()` could return the wrong string when a getter changed the object while it was being cloned.

<!-- https://github.com/oven-sh/bun/commit/865130f6529c9b3876cb7b78d18cd226fc5ebad8 -->

- Fixed: a crash when a Worker used an object URL for a named `File` made in another Worker, or when several Workers got the same `BroadcastChannel` message with objects.

<!-- https://github.com/oven-sh/bun/commit/97420a74fb1981a671221b8f73b135a7eeff7f51 -->

- Fixed: a crash when a resizable `ArrayBuffer` shrank during `Bun.zstdCompress()` or an `fs` call.

<!-- https://github.com/oven-sh/bun/commit/9dc3a59f097d54875a62d9d972b1682ace7767a4 -->

- Fixed: in rare cases, a string of 1 to 3 characters could load with the wrong value from the bytecode cache.

<!-- https://github.com/oven-sh/bun/commit/63afd77bd29c5117256af7d4708fafdfe372011a -->

- Fixed: printing an `AggregateError` without an `errors` property crashed.

<!-- https://github.com/oven-sh/bun/commit/c9585f70ba205cedad99f6ea974f18b0779e00b2 -->

- Fixed: an error thrown by a `mock.module` export getter, or by a Proxy trap or `toJSON` during `Bun.inspect`, was silently ignored.

<!-- https://github.com/oven-sh/bun/commit/025570f4b6cbf7ba05fb74f9277e399112ecfc50 -->

- Fixed: a possible crash when a system call returned an errno Bun did not know, such as one from a FUSE filesystem. Bun reports `EUNKNOWN` instead.

<!-- https://github.com/oven-sh/bun/commit/bd630c1d7e424dff1634840eebbb168f89d5188b -->

- Fixed: an unparseable `LANG`, `LC_ALL`, or `LC_MESSAGES` value crashed `Date` and `Intl` calls.

<!-- https://github.com/oven-sh/bun/commit/a443fa91aad60b709f8a740502e411850a28d391 -->

- Fixed: `--inspect` crashed when `NODE_ENV` contained characters like a stray `\r`.

<!-- https://github.com/oven-sh/bun/commit/46f098f908c0b78f627833f1b6822e9841c202e4 -->

- Fixed: piped stdout got ANSI color codes when stderr was a TTY, e.g. `bun test | pbcopy`.

<!-- https://github.com/oven-sh/bun/commit/bedb01e961a70c74daabef7fd82c083a4c2795e3 -->

- Fixed: `process.versions.icu` and `process.versions.unicode` reported the wrong ICU version on macOS.

<!-- https://github.com/oven-sh/bun/commit/f98bda3e01a7f9e649c8cbc0c79d2a35093facfc -->

- Fixed: the FreeBSD binary failed to load on FreeBSD 15 with a missing `libutil.so.9`.

<!-- https://github.com/oven-sh/bun/commit/2c0284ee848250a84f2ec7591e439159484435b0 -->

- Fixed: `bun --watch` crashed on a forced reload when colors were enabled.

<!-- https://github.com/oven-sh/bun/commit/99c9afe7f16b085b93999ace7ab0d6b816bb2b03 -->

- Fixed: on Linux, a `bun --watch` reload could in rare cases abort the process if another thread was starting at that moment.

<!-- https://github.com/oven-sh/bun/commit/ceef54734d1c4d337badbce76635cf6ca892cbd3 -->

- Fixed: `bun -p` printed `undefined` when `bunfig.toml` set `hoistPattern` or `publicHoistPattern`.

<!-- https://github.com/oven-sh/bun/commit/dbad47ad4afcf498c111c6f38a0a2770116f0aec -->

- Fixed: `bun completions` and `bun upgrade` crashed on macOS and Linux when `$SHELL` was PowerShell.

<!-- https://github.com/oven-sh/bun/commit/66a8b8852ca764a5a2d324552771d9e0dd206967 -->

- Fixed: the REPL highlighter did not color numeric separators like `1_000` or BigInt `n` suffixes.

<!-- https://github.com/oven-sh/bun/commit/a46c250daf1fe0f4a674a56f13d539ff7bb9f430 -->

- Fixed: the REPL froze when typing `.` after a large `Buffer` or typed array.

<!-- https://github.com/oven-sh/bun/commit/aff756f8e7e287571287c78d91028656dd7d37cd -->

- Fixed: `bun repl` left stale rows behind when input wrapped past the terminal width.

<!-- https://github.com/oven-sh/bun/commit/ab559668d2cac98bf13ec5d566cd41d30aa4d5ed -->

- Fixed: a 1.4.0 regression where `join()`, `toString()`, `String(arr)`, or `arr | 0` on an array that contains itself threw `RangeError: Maximum call stack size exceeded` instead of treating the cycle as empty, which broke three.js `WebGPURenderer`.

<!-- https://github.com/oven-sh/bun/commit/b1f7b8e36f5368c18c4c902c30ec7e403e5c4850 -->

- Fixed: a crash when two signals with `process.on("SIG...")` listeners were delivered on different threads at the same time, most often on macOS while a `Bun.spawn()` was in progress.

<!-- https://github.com/oven-sh/bun/commit/a97557a308ca6191683a3edf729be80d26e17424 -->

### bun install

- Fixed: a no-op `bun install` with the isolated linker took seconds instead of milliseconds in monorepos where a shared dependency declared a peer that no parent package provided (12.9s → 23ms in one 16-workspace repo).

<!-- https://github.com/oven-sh/bun/commit/06820dc10fd31bc21c7a7e65743978a62d00843d -->

- Fixed: `bun install` hung on "Resolving dependencies" when a transitive peer dependency's manifest was cached from a different registry URL.

<!-- https://github.com/oven-sh/bun/commit/e2204e3f31b9ca46c2de5820a745a61544653309 -->

- Fixed: when the connection dropped partway through a tarball or manifest download, `bun install` printed a misleading error instead of retrying.

<!-- https://github.com/oven-sh/bun/commit/469a7b4ff4d29c94e6c19451237c2f430c94899b -->

- Fixed: `bun install` runs that cached the same package manifest at the same moment could lose the cache entry, mostly on Windows.

<!-- https://github.com/oven-sh/bun/commit/7ca12365c4e13165504ee16300838e4b34400b4b -->

- Fixed: `bun install` silently skipped GitHub dependencies migrated from `package-lock.json`.

<!-- https://github.com/oven-sh/bun/commit/93eecdc98be498b9936dda568e8a1284cbcaf368 -->

- Fixed: migrating a pnpm project could corrupt `package.json`.
  - `bun add` and `bun update -i` crashed or wrote invalid content to `package.json` when `pnpm-lock.yaml` and `pnpm-workspace.yaml` were still present.
  - `bun install` could write corrupted `overrides`, `catalog`, and `patchedDependencies` entries when `pnpm-workspace.yaml` used quoted or multi-line values.

<!-- https://github.com/oven-sh/bun/commit/da6002c619630ff4c21bca548edc09fafcb042c1 -->

- Fixed: `bun install` panicked when a dependency's package.json declared `patchedDependencies`.

<!-- https://github.com/oven-sh/bun/commit/56c4e3d51ac71a21adeb0dacba2b82bf70a9ea63 -->

- Fixed: `bun install` failed with "unsafe folder path" when a `file:` package had a `catalog:` peer on another `file:` dependency with an absolute path.

<!-- https://github.com/oven-sh/bun/commit/5ff2d9f0901e1dd6f0feb13337811eeea33070cb -->

- Fixed: `bun install` panicked when a project path was too long to link a package's bins.

<!-- https://github.com/oven-sh/bun/commit/27f06448c96df1d61c4741e4f8ca60c085f91ad8 -->

- Fixed: in rare cases, auto-install could crash when a package lookup returned 404 while other modules were loading.

<!-- https://github.com/oven-sh/bun/commit/d1b7fac3bfb2c34177f93dcfe73caaad06cc9664 -->

- Fixed: Ctrl-C during `bun install` with git dependencies signaled `git` instead of stopping Bun.

<!-- https://github.com/oven-sh/bun/commit/22f5249e2c231f6074853ff0a6bb40f4155b8447 -->

- Fixed: `bun install` printed an EISDIR error when `.env` was a directory, and hung when it was a FIFO.

<!-- https://github.com/oven-sh/bun/commit/f05c8c3f6e892fef58e767b439a75a8a396c018a -->

- Fixed: `bun add` of a new git commit for an existing dependency duplicated its package.json key.

<!-- https://github.com/oven-sh/bun/commit/13c02e1646a0964f5d9c741b7dece72aba50557d -->

- Fixed: `bun add github:user/repo` wrote the dependency out of alphabetical order in `bun.lock`.

<!-- https://github.com/oven-sh/bun/commit/c89fc95d694b70c45c7eafd1ff00dfb35db54401 -->

- Fixed: `bun install` wrote an empty range to `bun.lock` for an 8-byte range ending in a non-ASCII character, such as `1.0.0-é`.

<!-- https://github.com/oven-sh/bun/commit/d8477b1d8ce4d2c7eb5b9a8d8af7d2c2858a6432 -->

- Fixed: `bun update --global --recursive` errored instead of ignoring `--recursive` as Bun 1.3 did.

<!-- https://github.com/oven-sh/bun/commit/f0004ad4256703b184b7b4c3eea3e7702abb7e39 -->

- Fixed: `bun prune` refused to run after `node_modules` was deleted and reinstalled with a different linker in a workspace.

<!-- https://github.com/oven-sh/bun/commit/84c364edfbcbd411621e858cacf9b7b40039541b -->

- Fixed: `bun pm ls` listed a package twice when the root declared it twice, such as a workspace also listed in `devDependencies`.

<!-- https://github.com/oven-sh/bun/commit/b4684c80cb44e77155c91b312346af96caacb772 -->

- Fixed: `bun pm diff` failed with "invalid archive entry size" on tarball files over 64 MiB.

<!-- https://github.com/oven-sh/bun/commit/bae959dc2a165fe1a2b0b8e815699cc5c91d2ae7 -->

- Fixed: depending on a workspace via `"pkg": "*"` when that workspace had no `version` (or a prerelease version) made every `bun install` re-resolve it, and `bun prune` / `bun dedupe` failed with "bun.lock does not match package.json".

<!-- https://github.com/oven-sh/bun/commit/f942cb004953245b759298ec1d590ff5ff189b86 -->

- Fixed: `bun install --backend=copyfile` truncated a package's files and its global cache entry to 0 bytes when the `node_modules` destination was already a hardlink to that cache file from an earlier install.

<!-- https://github.com/oven-sh/bun/commit/30f815988867dc6dacf5b2493ae3d1331f572725 -->

- Fixed: `bun pm pkg set`, `bun pm version`, `bun pack`, and `bun publish` rewrote power-of-ten integers from `10000` to `1000000000` in package.json in exponent form like `1e4`.

<!-- https://github.com/oven-sh/bun/commit/dcd85697ac232ae2ca3aba5ddc8fa2a491131c89 -->

### bun run and bun init

- Fixed: `bun run --filter`, `--workspaces`, `--parallel` and `--sequential` ignored an auto-discovered `bunfig.toml` unless `--config` was passed.

<!-- https://github.com/oven-sh/bun/commit/214dc49d8be246a0bda207f83c5690eca2f818e9 -->

- Fixed: `bun run` could reuse stale cached output for a file of 4 KiB or more after a bunfig `[define]` or `--drop` value changed.

<!-- https://github.com/oven-sh/bun/commit/9439a2432e5dc5ad49ce243fcba257baa2acc3db -->

- Fixed: `bun init` crashed when an existing package.json had a `devDependencies` or `peerDependencies` value that was not an object, like `null`.

<!-- https://github.com/oven-sh/bun/commit/13734bbda2a73a75c6077df1cedaf2f0fa18e3d6 -->

- Fixed: pressing Ctrl-D at a `bun init` text prompt printed an internal error.

<!-- https://github.com/oven-sh/bun/commit/83c3a5b8d8bbd442744b9ec8cd28470c49937d99 -->

### bun build

- Fixed: with several entry points and no `--splitting`, `Bun.build` could crash or print the wrong text for a constant-folded string in a shared module.

<!-- https://github.com/oven-sh/bun/commit/11e0f96b65562a8af5ef81eaaa19323b6c984d23 -->

- Fixed: in rare cases `bun build` gave a nested variable the same name as a top-level function, so the output threw "is not a function".

<!-- https://github.com/oven-sh/bun/commit/1314777975df7f4d82eff2090fa2cbaa5b5ecd82 -->

- Fixed: a 1.4.0 regression where an `onResolve` plugin returning `undefined` could make `Bun.build()` drop code from a `sideEffects: false` package, causing a `ReferenceError`.

<!-- https://github.com/oven-sh/bun/commit/1b88cd8485c3bc90977924462c4485ad62d6695e -->

- Fixed: with `--format=esm`, an entry point that re-exported `foo` from a CommonJS module could clash with another `export_foo` in the bundle.

<!-- https://github.com/oven-sh/bun/commit/5da67e30c99f9bdc779fa0c8522cdbf82f8b7420 -->

- Fixed: `bun build` returned all of `module.exports` for a default import of an `__esModule` CommonJS module from a `.js` or `.ts` file, unlike `bun run`.

<!-- https://github.com/oven-sh/bun/commit/7d9fc6d723409f59a465eebcde20dfbae90a74f9 -->

- Fixed: `bun build` emitted an empty file for an entry point that only did `module.exports = require(...)`.

<!-- https://github.com/oven-sh/bun/commit/bedc5c08db3b6a201e7b930b8eae48802e2df8af -->

- Fixed: several `bun build` bugs in the barrel file optimization for `sideEffects` packages.
  - A module listed in a package's `sideEffects` array was dropped when it was only reachable through a re-export barrel.
  - `Bun.build` reported an unresolved re-export twice and ran `onResolve` plugins more than once for it in `sideEffects: false` barrels.
  - A `sideEffects: false` entry point made only of re-exports emitted an `export { a }` with no declaration.

<!-- https://github.com/oven-sh/bun/commit/7fd3b23b3d9fe770264272ea36f62057083b1367 -->

- Fixed: a 1.4.0 regression where unused classes with a computed key naming a constant, like `[TypeId]`, were not tree-shaken, bloating Effect bundles.

<!-- https://github.com/oven-sh/bun/commit/94024bd768b7a39f110193ec59f3213fe5081721 -->

- Fixed: with `--splitting`, `bun build` could fail with "Multiple files share the same output path" when tree shaking removed all code from two imported files.

<!-- https://github.com/oven-sh/bun/commit/d4ae7c4fd315409097cf08eeac4d134a3ab5fbcb -->

- Fixed: `bun build` crashed when every entry point was disabled or marked external.

<!-- https://github.com/oven-sh/bun/commit/3ce8a769bb20bd606da0c05001f9bf4546a4d9c9 -->

- Fixed: `bun build node:fs` and other builtin entry points failed with "File not found" instead of saying builtins cannot be entry points.

<!-- https://github.com/oven-sh/bun/commit/6f27257bb23a4fb9478cd640dcfd9f87aedae1a4 -->

- Fixed: `events.once()` threw a `ReferenceError` in `bun build --target=browser` bundles.

<!-- https://github.com/oven-sh/bun/commit/7b31eddfb8fb0dd5998037e00605953e37dedd7d -->

- Fixed: `import "./foo.cjs"` did not find `foo.cts`, and an exact `exports` or `imports` target ending in `.js` did not fall back to the `.ts` file.

<!-- https://github.com/oven-sh/bun/commit/56efde1fca963be175fd9af5c90ac22f848fddfd -->

- Fixed: several bugs with macros in `bun build` and `Bun.build()`.
  - Macros ignored `--define`, `--loader`, and tsconfig settings while bundling.
  - A macro that awaited `crypto.subtle.digest()` hung the build.
  - A macro returning `Response.json()` was inlined as a base64 `data:` URL, not an object.

<!-- https://github.com/oven-sh/bun/commit/88b0fb8b1f4642a1ead0bf5530e4f2fdbec580a7 -->

- Fixed: `reactCompiler` added an unused `react/compiler-runtime` import to components with no memoization.

<!-- https://github.com/oven-sh/bun/commit/3951764536c1f163ad45a2365744b28e99a5e445 -->

- Fixed: Bun crashed on the first JSX element when a tsconfig `jsxFactory` or `jsxFragmentFactory` had no identifier in it, like `""` or `"."`.

<!-- https://github.com/oven-sh/bun/commit/9393da43e9552d5544cd0368e291476a990ff366 -->

- Fixed: with syntax minification, the transpiler mishandled declarations that read members of the same object.
  - `var a = o.x, b = o.y` became one destructure even when `o` could change between the reads, like a global with a getter.
  - `var n = n.next, n = n.next` read both members from the original `n`.
  - `bun build --minify` emitted invalid code for `using a = obj.x, b = obj.y` inside a function.

<!-- https://github.com/oven-sh/bun/commit/1ba2ca98d6d7390ee3c96aeede06a04d36f20480 -->

- Fixed: `Bun.Transpiler#scanImports` garbled non-ASCII import specifiers.

<!-- https://github.com/oven-sh/bun/commit/3e8b2e6b1ec0e8ce9f384776eacf30c91ee7031c -->

- Fixed: `--metafile`, `bun audit --json`, and `bun pm view --json` wrote invalid JSON when a string held malformed UTF-8 or a lone surrogate.

<!-- https://github.com/oven-sh/bun/commit/79936e42ab9ea1b22c73782b311d3e6ffe6999e5 -->

- Fixed: `bun build` on Windows wrote backslash-separated asset paths and HTML manifest entries.

<!-- https://github.com/oven-sh/bun/commit/17e16cf1a996a22c74ef7f9a01efb273e5bc7895 -->

- Fixed: dev server `<img>` URLs in HTML imports returned 404 after editing the HTML file.

<!-- https://github.com/oven-sh/bun/commit/2bf11c53f5b692344dfa3b6bcf8183bd86010de2 -->

- Fixed: dev server crashed when editing a file imported from outside the project root.

<!-- https://github.com/oven-sh/bun/commit/e0a6d0212807da9ab35575f727844d43ec7a0852 -->

- Fixed: `bun index.html` crashed on an anonymous `export default class extends React.Component {}`.

<!-- https://github.com/oven-sh/bun/commit/3b98d7eb667f1e5a2587e447fe224622507cba65 -->

- Fixed: `bun build` without `--splitting` wrote only one output file when several entry points imported each other. When one entry point imported another, modules in its output could also run in the wrong order.

<!-- https://github.com/oven-sh/bun/commit/14ab660f7c63332748e7d7000e14f9ca4c5fa015 -->

- Fixed: with `--splitting`, `await import()` of a CommonJS module in another chunk (e.g. `react-dom/client`) resolved to `{ default }` only, so named exports like `createRoot` were `undefined`.

<!-- https://github.com/oven-sh/bun/commit/473335d85f18774cdce216daf942d25fa08360f1 -->

- Fixed: `bun build` produced broken output for `import * as ns` of a CommonJS module that assigns `exports.x = ...`:
  - `ns.method()` calls, and `exports.fn()` calls inside the module itself, dropped `this`, so a method that read `this._helper` threw `undefined is not an object` (e.g. `stack-trace`).
  - Modules that also read `module.constructor`, `module.hot`, or `module.paths` threw `ReferenceError: module_lib is not defined` (e.g. `pirates`).
  - Modules that declared a `var` with the same name as one of their top-level functions threw `SyntaxError: Cannot declare a var variable that shadows a let/const/class variable` when the ESM bundle loaded.

<!-- https://github.com/oven-sh/bun/commit/f31440d21d491ab403e322fe539429c2ebaa9661 -->

- Fixed: `bun build` resolved `ns[Enum.member]` on an `import * as ns` namespace to the wrong export when the `const enum` member's value was a concatenated string like `"a" + "b"` (it read export `a` instead of `ab`).

<!-- https://github.com/oven-sh/bun/commit/8f9aece153a7984787058e5ad986c454509f0cac -->

- Fixed: `bun build` tree-shaking removed an unused destructuring declaration like `const { x } = obj` even when the destructuring could run a getter or iterator with side effects.

<!-- https://github.com/oven-sh/bun/commit/36fc0d9d4f3fad343deb77fdce42c15375a3de39 -->

- Fixed: `Bun.build` ignored the `path` an `onResolve` plugin returned with `external: true`, so a plugin could not rewrite an external import to a different path or URL.

<!-- https://github.com/oven-sh/bun/commit/c34a1a5c43e622d8ed0ca6bd2b32c81d0aab687d -->

### bun build --compile

- Fixed: `bun build --compile` binaries for darwin-arm64 in rare cases failed `codesign -v` and were killed on macOS 27.

<!-- https://github.com/oven-sh/bun/commit/5ceb39ddb3e44b1af058fb406667021d60864ce3 -->

- Fixed: UPX-compressed `bun build --compile` executables failed on Linux with `Invalid character: '\0'`.

<!-- https://github.com/oven-sh/bun/commit/5ad645598933779d5846a24d4f3cf7542379f127 -->

- Fixed: a 1.4.0 regression where `bun build --compile` failed with `EACCES` when run from a WSL2 `/mnt/c` path.

<!-- https://github.com/oven-sh/bun/commit/e5cf9e9f1c5420e14e67025866c98a7fac198934 -->

- Fixed: `bun build --compile` for macOS panicked instead of erroring when the executable exceeded 4 GiB.

<!-- https://github.com/oven-sh/bun/commit/8025074f0b29d5ab7fabdf860ef6bade88a4ad01 -->

- Fixed: a 1.4.0 regression where `Bun.build({ compile: true })` with no `outfile` or `outdir` wrote the executable next to the entrypoint, not the working directory.

<!-- https://github.com/oven-sh/bun/commit/427edf3e8a3e9221b5263f52137f1c0d1645aefb -->

- Fixed: `new Worker(new URL("./worker.ts", import.meta.url))` could not find the worker in `bun build --compile` executables.

<!-- https://github.com/oven-sh/bun/commit/b49398c4ad867580972cf7f43e4ee2679f1a6a40 -->

- Fixed: `Bun.Glob` `scan()` threw `ENOENT` on embedded directories in compiled executables.

<!-- https://github.com/oven-sh/bun/commit/731f0b5f93f786eddac8622dee8b2ee2dd34abec -->

- Fixed: `bun build --compile` executables ran with the JIT and GC throttled when their own arguments included `-e`, `-p`, `--eval` or `--print`.

<!-- https://github.com/oven-sh/bun/commit/7c9a51e75797e81a9c9764832f93588a5cd20ad1 -->

- Fixed: `bun build --bytecode` intermittently aborted on large builds.

<!-- https://github.com/oven-sh/bun/commit/a3745c2642f3ab216b23cdf65ddc4346b3ccd356 -->

- Fixed: `--compile --bytecode` chunks with non-ASCII text silently skipped their bytecode cache.

<!-- https://github.com/oven-sh/bun/commit/db8275cd20045b12f61b381926dc4e5f5a472389 -->

- Fixed: in a `--compile --splitting` executable, `import()` of the entry point from another chunk failed with `Cannot find module '/$bunfs/root/<entry>.js'`. The entry point's external source map is now written to `<outfile>.map`.

<!-- https://github.com/oven-sh/bun/commit/497069ec59bce678a262ed439ad31ca95ffd4445 -->

- Fixed: `bun build --compile` targeting Linux with more than 4 GiB of embedded files produced an executable that failed at startup with `Module not found ''`. The build now errors instead.

<!-- https://github.com/oven-sh/bun/commit/1564c1eead0bb45d5015d32d8664dfa3a4769a68 -->

### bun test

- Fixed: in rare cases, `bun test --parallel` hung forever when a worker process exited before it finished starting up.

<!-- https://github.com/oven-sh/bun/commit/2a0fda972f57d72666f662788e8bff857caf9b61 -->

- Fixed: `bun test --parallel --coverage` under-reported function coverage for a file when different workers ran different functions in it.

<!-- https://github.com/oven-sh/bun/commit/07b0f7bffcd27190b458ff7239df6c9ab6141d95 -->

- Fixed: on Windows, `bun test --parallel` or `--isolate` could crash when more than one test file used `Bun.WebView`.

<!-- https://github.com/oven-sh/bun/commit/5ab2bd9b25443e464469124dd9a5fb7357fc31bd -->

- Fixed: `Bun.spawn` and `child_process` with piped stdio failed with `EBADF` inside `bun test` on macOS in repos with thousands of directories.

<!-- https://github.com/oven-sh/bun/commit/e8300da20bac48dac79b71d741583b1043eb1c7d -->

- Fixed: under `jest.useFakeTimers({ now })` and `setSystemTime()`, `performance.timeOrigin` stayed on the real clock, so `timeOrigin + performance.now()` did not match `Date.now()`.

<!-- https://github.com/oven-sh/bun/commit/29b958ffb0cf5ccd7b7b37b6d4b54e77c8fde87a -->

- Fixed: `mock.module()` silently swallowed errors thrown by a `Bun.plugin` `onResolve` hook.

<!-- https://github.com/oven-sh/bun/commit/1f0c898993e12896e29be5ee306e4e2c9e0ae639 -->

- Fixed: `mockResolvedValue()` and `mockResolvedValueOnce()` swallowed the error when reading the value's `constructor` property threw.

<!-- https://github.com/oven-sh/bun/commit/3ee980151d8ed01bfbba0b9cbf8a66338eefa861 -->

- Fixed: `this.utils.printReceived()` in an `expect.extend` matcher crashed when a custom inspect threw.

<!-- https://github.com/oven-sh/bun/commit/12367c01ee3c44c3459914d5bc18cdc542358401 -->

- Fixed: when a `Set`, `Map`, `WeakSet`, or `WeakMap` had a non-numeric own `size` property, a failing `toEqual()` printed a bare `TypeError` instead of the diff.

<!-- https://github.com/oven-sh/bun/commit/4e1eeff48be4c58b8e2f5333bd9792a5942e52ed -->

- Fixed: `expect(x).toBeWithin(a)` with one argument crashed `bun test` instead of failing.

<!-- https://github.com/oven-sh/bun/commit/a27a7a1a12ad17a06ac27afdd8d516f6f2934b91 -->

- Fixed: when the `toSatisfy()` predicate threw, `bun test` wrapped the error in an `AggregateError` that could crash `console.log`. It now rethrows the predicate's error.

<!-- https://github.com/oven-sh/bun/commit/d43ddf309addfb72f028cab0fccc9d707e0590d9 -->

- Fixed: `toMatchObject()` and `Bun.deepMatch()` crashed on objects nested thousands of levels deep instead of throwing `RangeError`.

<!-- https://github.com/oven-sh/bun/commit/df752066251c717fba7e1a6b153c1959109bc96b -->

- Fixed: JUnit reports and GitHub Actions annotations crashed when an error's stack included a long `data:` URL module or a long `//# sourceURL=` name.

<!-- https://github.com/oven-sh/bun/commit/a63ef2de7e5a8ed83508daec61ea8d676c7ea19c -->

### Bun Shell

- Fixed: Bun Shell split `export NAME=$(cmd)` output on whitespace instead of keeping one value.

<!-- https://github.com/oven-sh/bun/commit/0fbdf0de98f7cb64f2b96782c24e80a6996ad361 -->

- Fixed: a Bun Shell pipeline hung forever when it could not create its pipes because the process was out of file descriptors (`EMFILE`).

<!-- https://github.com/oven-sh/bun/commit/173e280039f17173da3d3ad6baf38d20ab9794e1 -->

- Fixed: Bun Shell `ls` errored on a dangling symlink operand, and `ls file/x` printed the path instead of a "Not a directory" error.

<!-- https://github.com/oven-sh/bun/commit/d1305b4a21f2176e2b4caa1c7f4ddf8db8581626 -->

- Fixed: after `` await $`cmd > ${buf}`  ``, the ArrayBuffer could stay pinned if the child's stdout closed after it exited, for example when a grandchild held it open.

<!-- https://github.com/oven-sh/bun/commit/d4433980d3d5d6b403b561aa1dbf716e4ce05d85 -->

### TypeScript types

- Fixed: `@types/bun` broke `Event.composedPath()` types when `lib: ["dom"]` was enabled.

<!-- https://github.com/oven-sh/bun/commit/1ab272b83350e4b38093a12aa8d59a37e1dfef8f -->

- Fixed: with `@types/node@24` installed, `process.off()` and `process.removeListener()` rejected every event name except `memoryPressure`.

<!-- https://github.com/oven-sh/bun/commit/41906a42713e8cf1a65d2de277db0e646d28877e -->

- Fixed: TypeScript rejected `fetch(url, { protocol: "h3" })`. Bun supports it at runtime.

<!-- https://github.com/oven-sh/bun/commit/a54b30b30c714e43c6622ae7a43acb8c94dcb8f9 -->

- Fixed: TypeScript parse errors on `a ? (b) : c => d`, `export type` followed by a newline, and `import type from`.

<!-- https://github.com/oven-sh/bun/commit/38f35d4b96a91045865a630833410642a136859f -->

### Windows

- Fixed: on Windows, `bun install` workspace pattern errors and some other error messages said `NOENT` instead of `ENOENT`.

<!-- https://github.com/oven-sh/bun/commit/03a3f9f2506a92082a05644f0ebf9e962111023a -->

- Fixed: on Windows, `Readable.fromWeb(Bun.file(path).stream())` could crash while reading a file larger than the stream buffer.

<!-- https://github.com/oven-sh/bun/commit/0905284eacdb1265e5f42a4a995f191cc934fe8e -->

- Fixed: on Windows, `fs.copyFile` reported success when the copy failed with an error code Bun did not recognize, such as a missing network share.

<!-- https://github.com/oven-sh/bun/commit/2b3f6601163ca35a1e354514d5586f27cdfb135c -->

- Fixed: on Windows, `process.chdir()` during a recursive `fs.rm` could close an unrelated handle.

<!-- https://github.com/oven-sh/bun/commit/420d0497b19ccb01542f0512899c8cddac6d4893 -->

- Fixed: on Windows, `child_process.spawn()` with extra stdio pipes could close unrelated handles.

<!-- https://github.com/oven-sh/bun/commit/6e10a65490be42a567540015e99bca116bc9d0d6 -->

- Fixed: on Windows, Bun leaked memory when connecting to a named pipe failed.

<!-- https://github.com/oven-sh/bun/commit/46a796a5d12733e7f188af0185d0971591717cb7 -->

- Fixed: on Windows, a named-pipe socket could crash if its `data` or `end` handler closed it and then ran the event loop, as `expect().resolves` does.

<!-- https://github.com/oven-sh/bun/commit/d2659a7bf247498fb1f326c865f8f6d521d883f1 -->

- Fixed: on Windows, closing `process.stdin` or `Bun.stdin.stream()` while a console read was pending could corrupt memory and cause a later crash.

<!-- https://github.com/oven-sh/bun/commit/ef3bcfddc63bbe1ef15cab3e6bf1a2524e57efc6 -->

- Fixed: on Windows, `child_process`, `Bun.spawn`, and `Bun.which` could not find `.com` executables like `chcp`. `child_process` regressed in 1.4.0.

<!-- https://github.com/oven-sh/bun/commit/e83de42948929cc3a7de215ce20d765ca3d69822 -->

- Fixed: `bun run` exited as soon as Ctrl+C was pressed, before the script finished handling it. This affected Windows and `--shell=bun`.

<!-- https://github.com/oven-sh/bun/commit/9dd73746c7b51b6450bb675ce2abcf86a0ae076f -->

- Fixed: on Windows arm64, in rare cases a process that used WebAssembly could hang on exit.

<!-- https://github.com/oven-sh/bun/commit/6d13a3a9bf59720fae6c442e422616f7a53db984 -->

- Fixed: on Windows Server 2019, the crash report said "CPU lacks AVX support" and omitted the `CPU:` line on CPUs that do support AVX.

<!-- https://github.com/oven-sh/bun/commit/1d1f4319b8863b95c7c4b7d05b5a68d1b5a97ef4 -->
