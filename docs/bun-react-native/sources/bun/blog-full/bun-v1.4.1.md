---
source: https://bun.com/blog/bun-v1.4.1 (markdown: https://bun.com/blog/bun-v1.4.1.md)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504 (docs repo HEAD at fetch time; blog posts fetched from bun.com)
---

---
title: Bun v1.4.1
description: "Fixes 202 issues, addressing 236 👍. HTTP/2 in Bun.serve, Bun.write() streams Response bodies to disk, self-contained workspace node_modules, bun install --offline and --prefer-offline, WebSocket pause() and resume(), crypto.argon2, tree-shaking through dynamic import(), smarter CommonJS to ESM conversion for default imports, --compile --bytecode when cross-compiling, smaller and faster-starting compiled executables, up to 9x faster Buffer reads and writes, 2x faster AsyncLocalStorage, faster startup, and many bugfixes and Node.js compatibility improvements."
date: "2026-09-04T06:47:12.361Z"
author: jarred
---

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

### Reduced idle memory usage

We've made JavaScriptCore delete JIT-generated code after an extended idle period, reducing memory usage for long-running processes.

RSS after 60 seconds of load followed by 3 minutes idle, on Linux x64:

| App         | Bun v1.4.1 | Bun v1.4.0 | Bun v1.3.14 | Node.js v26 |
| ----------- | ---------: | ---------: | ----------: | ----------: |
| Next.js SSR |     142 MB |     222 MB |    1,303 MB |      195 MB |
| `vite dev`  |     111 MB |     142 MB |      292 MB |      115 MB |
| Express     |      53 MB |      65 MB |       76 MB |       83 MB |
| Fastify     |      55 MB |      65 MB |       78 MB |       89 MB |
| Elysia      |      44 MB |      46 MB |       69 MB |       96 MB |
| Hono        |      34 MB |      35 MB |       53 MB |       92 MB |

<!-- https://github.com/oven-sh/bun/commit/6c06195725247f9acafb15d46e907a542f83db5e -->

### `Bun.serve` supports HTTP/2

`Bun.serve` now supports HTTP/2 on the same port as HTTP/1.1. Both protocols use the same `routes` and `fetch` handler. `req.url` and `req.body` behave identically on each.

```ts
Bun.serve({
  tls: { key, cert },
  http2: true,
  fetch(req) {
    return new Response("hi");
  },
});
```

Over TLS the protocol is negotiated with ALPN. On cleartext connections, a client that sends the HTTP/2 preface is served HTTP/2. Set `http1: false` to refuse HTTP/1.x clients. WebSockets and response trailers are not yet supported over HTTP/2.

![Bar chart: HTTP/2 over TLS requests per second on Linux x64, Bun.serve() vs node:http2 in Bun vs node:http2 in Node.js v26. Hello World GET: 291,512 vs 55,619 vs 42,733 (6.8x faster). POST 4 KB body: 136,077 vs 45,366 vs 30,112 (4.5x). 2 KB URL: 113,648 vs 43,168 vs 31,249 (3.6x). 64 KB response: 17,357 vs 13,771 vs 12,979 (1.3x). Streaming 256 KB in, 32 KB out: 4,570 vs 4,563 vs 2,164 (2.1x). Bun v1.4.1 vs Node.js v26.3, 64 cores, loopback, h2load -c 64 -m 16 -t 8 -n 100000.](/images/bun-serve-http2-1.4.1.webp)

<!-- https://github.com/oven-sh/bun/commit/c6f335ffbd693783a3fd807b9d36819b11ca1d56 -->

### `Bun.write(path, response)` streams to disk

`Bun.write()` now streams a `Response`, `Request`, or `ReadableStream` body into the file instead of reading it into memory first. Writing a 128 MiB download previously added 161 MB to peak RSS. It now adds 13 MB.

```ts
await Bun.write("./big.tar.gz", await fetch(url)); // => bytes written
await Bun.write("./out.txt", readableStream); // was "[object ReadableStream]"
```

`fetch()` and S3 downloads now pause when 256 KiB of the body is unread. A `Response` that is discarded without being read closes its connection.

<!-- https://github.com/oven-sh/bun/commit/e4c2af4cef72faae453a1955d621e90c73916e83 -->

### `WebSocket` supports `pause()` and `resume()`

Bun's `WebSocket` client now has `pause()` and `resume()` methods. They stop and restart reads from the underlying TCP socket.

```ts
const socket = new WebSocket("wss://example.com/feed");

socket.addEventListener("message", (event) => {
  if (!file.write(event.data)) {
    // the file's buffer is full: stop reading until it drains
    socket.pause();
    file.once("drain", () => socket.resume());
  }
});
```

The WHATWG `WebSocket` API cannot stop receiving messages without closing the connection. Messages that arrive faster than they are processed accumulate in memory. While a socket is paused, Bun does not read from it and the peer receives TCP backpressure.

```ts
socket.pause(); // => true
socket.isPaused; // => true
socket.resume(); // => true
socket.isPaused; // => false
```

Messages that were already decoded before the pause can still arrive. This is a Bun extension and is not available in browsers.

`socket.bufferedAmount` now reports how many bytes are still queued to send. It was previously always `0`. The `ws` package's `pause()`, `resume()`, and `bufferedAmount` work too.

<!-- https://github.com/oven-sh/bun/commit/52baef68017d552a2e8c3c297335d8ece84cf811 -->

### `node:crypto` supports `crypto.argon2` and `crypto.argon2Sync`

`crypto.argon2()` and `crypto.argon2Sync()` are now implemented. Previously, both were defined but threw `ERR_CRYPTO_ARGON2_NOT_SUPPORTED` when called. Feature detection therefore reported support that did not exist.

```ts
crypto.argon2Sync("argon2id", {
  message: "pw",
  nonce: "saltsalt",
  parallelism: 1,
  tagLength: 32,
  memory: 8,
  passes: 1,
});
// => <Buffer ...> (32 bytes)
```

- `argon2d`, `argon2i`, and `argon2id` are supported.
- `crypto.argon2()` runs on the thread pool with a callback.
- Output matches Node byte for byte.

<!-- https://github.com/oven-sh/bun/commit/31e447983b0679dfa5c8741428b5fb379cbbe9b1 -->

### Up to 9x faster `Buffer` reads and writes

`buf.readInt32LE()`, `buf.writeDoubleLE()`, and the rest of the `Buffer` `read*`/`write*` methods are inlined by the JIT into a bounds-checked load or store.

```ts
buf.writeFloatLE(1.5, 0); // 2.85ns -> 0.31ns (9.2x faster)
buf.writeUInt8(255, 0); // 2.24ns -> 0.31ns (7.2x faster)
buf.readUInt32BE(0); // 0.76ns -> 0.42ns (1.8x faster)
```

Measured on macOS arm64 against Bun v1.4.0. The `write*` methods sped up the most.

`readIntLE(offset, byteLength)` and its variable-width siblings are inlined too when `byteLength` is a constant 1, 2, or 4.

<!-- https://github.com/oven-sh/bun/commit/2082869555b6122324ade0df2a95d8e6e79d2f86 -->

### Faster `AsyncLocalStorage`

`AsyncLocalStorage.run()` is about 2x faster. An active store no longer costs an extra allocation on every `await`, `.then()`, or `.finally()`. An `await` inside `run()` is now as cheap as one outside it.

```ts
const als = new AsyncLocalStorage();

als.run({ requestId }, async () => {
  await next(); // no per-await allocation for the store
  als.getStore(); // { requestId }
});
```

| ns/op                        | Node 26 | Bun, before | Bun v1.4.1 |
| ---------------------------- | ------: | ----------: | ---------: |
| `als.run(v, fn)`             |     410 |        28.8 |       15.9 |
| 3x nested `run()`            |    2833 |         338 |       57.8 |
| `await` under a store        |    36.8 |        44.1 |       34.5 |
| `Promise.all` of N `.then()` |     435 |         345 |        281 |

`enterWith()` called inside a timer, I/O callback, or request handler no longer leaks its store into the next unrelated callback. This matches Node.js.

<!-- https://github.com/oven-sh/bun/commit/685180aca5caceaab4061bc182aa08130fd16433 -->

### Faster `Bun.inspect`, `console.log`, and `util.inspect` on large values

Printing an object took time quadratic in its number of properties. It is now linear. `expect()` failure messages use the same code and are also faster.

```ts
Bun.inspect(objectWith16000Keys); // 140 ms -> 3.2 ms (43x faster)
```

`util.inspect` now stops walking an array or typed array once it reaches `maxArrayLength`, instead of visiting every element and discarding the rest. Output is unchanged. REPL tab completion on big arrays gets the same speedup.

```ts
util.inspect(new Array(2e6).fill(7), { maxArrayLength: 3 }); // 2090 ms -> 42 ms
```

<!-- https://github.com/oven-sh/bun/commit/5f0bf145318e7e08740a4298dc9998d915446411 -->
<!-- https://github.com/oven-sh/bun/commit/06d0ae8ac19503537862df677249c9242509e432 -->

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

### Faster first HTTPS request

The first TLS connection in a process starts up to 3x faster.

Time from process start to the first `fetch("https://…")` response, on Linux x64:

| Root certificates          | Bun v1.4.1 | Bun v1.4.0 |
| -------------------------- | ---------: | ---------: |
| Bundled (default)          |    10.3 ms |    17.6 ms |
| System (`--use-system-ca`) |    15.3 ms |    46.3 ms |

Bun now embeds its root certificates as DER and only parses one when a certificate chain needs it.

An expired certificate in a trust store no longer hides a valid certificate for the same issuer. BoringSSL is updated to current upstream.

<!-- https://github.com/oven-sh/bun/commit/85de2568f3bf3d78a0ccf707e2d7d520528a54a3 -->

### `fetch()` reuses unix socket connections

`fetch()` over a unix socket keeps connections alive and reuses them, like it already does for TCP.

```ts
for (let i = 0; i < 3; i++) {
  await fetch("http://localhost/x", { unix: "/tmp/app.sock" });
}
// before: 3 connections. now: 1
```

- `fetch(url, { unix, tls: { ca } })` uses the custom `ca`.
- A relative `unix` path no longer connects to the wrong socket after `process.chdir()`.

<!-- https://github.com/oven-sh/bun/commit/3f78cd93ee0bb961761067a22178b4cfab097c5b -->

### `localhost` and `*.localhost` resolve to loopback everywhere

`fetch()`, `WebSocket`, `Bun.connect()`, and `bun install` now resolve `localhost` and any `*.localhost` name to `::1` and `127.0.0.1` without querying the system resolver. This fixes connecting to a `Bun.serve()` bound to `"localhost"` inside a Docker container that only has IPv4.

```ts
await fetch("http://app.localhost:3000"); // works on macOS, Windows, and Linux
```

`node:net` and `node:dns` are unchanged.

<!-- https://github.com/oven-sh/bun/commit/f6d350d9809def1b26c7ab6df7b785d57eec862e -->

### `fetch()` verifies TLS against the URL, not the `Host` header

If `tls.servername` was not set, `fetch()` used a custom `Host` header as the TLS server name and checked the certificate against it - matching what `node:https` does. Bun now uses the URL's hostname, as Node's `fetch` and curl do. The `Host` header is still sent, but it no longer affects TLS.

The previous behavior was an insecure default. Applications that pass a `Host` header from user input to `fetch()`, as many proxies do, should upgrade.

```ts
// no longer fails with ERR_TLS_CERT_ALTNAME_INVALID
await fetch("https://a.example/", {
  headers: { Host: "b.example" },
});
```

To connect to an IP address and verify the certificate against a different name, set `tls.servername`:

```ts
await fetch("https://10.0.0.5/", {
  tls: { servername: "internal.example" },
});
```

<!-- https://github.com/oven-sh/bun/commit/f4d864bb56a1e775d1da5f0ce9872668dbb18b63 -->

### `binaryType = "blob"` on server WebSockets

`ServerWebSocket` and the built-in `ws` package now accept `"blob"`, like the native `WebSocket` client.

```ts
ws.binaryType = "blob"; // binary messages arrive as Blob
```

Previously, a `ws` server socket in `"arraybuffer"` mode emitted a `Uint8Array`. It now emits an `ArrayBuffer` to match npm `ws`.

<!-- https://github.com/oven-sh/bun/commit/d3e07690d54adad9e6981d3c2b7386cc5742f9ca -->

### `--env-file` reads pipes, FIFOs and `/dev/stdin`

An explicit `--env-file` can now read from process substitution, a named pipe, or stdin, as in Node. Secret managers such as 1Password can provide environment variables this way without writing them to disk.

```sh
bun --env-file=<(echo A=1) -e 'console.log(process.env.A)' # => 1
echo A=1 | bun --env-file=/dev/stdin app.ts
```

Reading from a FIFO blocks until a writer opens it. The default `.env*` lookup still skips non-regular files.

<!-- https://github.com/oven-sh/bun/commit/5add697e08e7d453fdd05632cef70cffa894b772 -->

### `--no-ffi-cc` disables `cc()` from `bun:ffi`

This prevents untrusted JavaScript from compiling and loading C code at runtime.

```sh
bun --no-ffi-cc ./script.ts
# cc() throws ERR_FFI_CC_DISABLED
```

`--no-addons` disables `cc()` too. Workers inherit both flags and cannot re-enable them.

<!-- https://github.com/oven-sh/bun/commit/72ffcd8ea51bf63c3c69378b4dec5cdeeb5ffc35 -->

### Import attributes are typed on TypeScript 7.1

With TypeScript 7.1 or later, `bun-types` types an import by its `with { type }` attribute.

```ts
import html from "./index.html" with { type: "text" }; // string, not HTMLBundle
import db from "./my.db" with { type: "sqlite" }; // Database
```

Covers `text`, `file`, `md`, `markdown`, `toml`, `yaml`, `jsonc`, `json5`, `xml`, `sqlite`, and `html`.

Older TypeScript versions keep the extension-based types.

<!-- https://github.com/oven-sh/bun/commit/d2b71fb957f598a5313bbcb6eed504f7c8df9396 -->

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

### Fewer, smaller chunks with `--splitting`

`bun build --splitting` now writes fewer files. Code that an entry shares with the routes it loads through `import()` stays in the entry's chunk. Previously it was placed in a separate chunk, which required one more request.

{% codetabs %}

```ts#main.ts
import { format } from "./format";
console.log(format(1));

document.body.onclick = async () => {
  // settings.ts also imports ./format
  const { settings } = await import("./settings");
  settings();
};
```

```sh#bun_build
bun build ./main.ts --splitting --outdir dist
```

{% /codetabs %}

This previously produced 3 files. It now produces 2.

| Before                            | Now                              |
| --------------------------------- | -------------------------------- |
| `main.js`                         | `main.js` (includes `format.ts`) |
| `settings-mn3j380d.js`            | `settings-mn3j380d.js`           |
| `chunk-2fk8vd1p.js` (`format.ts`) |                                  |

In a test app with one entry and 40 lazy routes:

|                           | Before | After |
| ------------------------- | -----: | ----: |
| Output files              |    219 |   151 |
| Output size               | 124 KB | 75 KB |
| Modules loaded at startup |     70 |     2 |

Two related bugs are also fixed:

- An entry no longer imports chunks it uses nothing from.
- Shared chunks run in the same order as the unbundled code.

### `--min-chunk-size`

`--min-chunk-size` folds small chunks into a chunk that more entries load.

```sh
bun build ./index.tsx --splitting --min-chunk-size=16384 --outdir out
```

```ts
await Bun.build({
  entrypoints: ["./index.tsx"],
  splitting: true,
  minChunkSize: 16 * 1024,
});
```

Only chunks with no top-level side effects are folded. Lazily loaded code stays lazy, and side effects do not run earlier.

Each entry gains at most about 1.5% unused code, so a large value is safe. The default is `0`, which turns it off.

| `bun build ./index.html --production --splitting` | without | `--min-chunk-size=16384` |
| ------------------------------------------------- | ------: | -----------------------: |
| Medusa admin dashboard, JS files                  |     349 |                      245 |
| Requests per route navigation, median / max       | 13 / 75 |                   8 / 30 |
| 50-route React SPA, JS files                      |     242 |                      123 |
| Requests per route navigation                     |      54 |                       15 |

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

### `require()` is a chunk boundary with `--splitting --target bun`

A `require()` of an ES module now gets its own chunk, as with `import()`. The call remains synchronous. A `require()` inside a function that never runs no longer loads that module at startup.

```ts
const { tool } = require("./tool.ts");
// bundled as: import.meta.require("./chunk-a1b2c3.js")
```

A `--compile --bytecode` benchmark had 400 lazily required modules, and 8 of them were used at startup. Startup time went from 23.2 ms to 11.2 ms and memory use from 34.6 MB to 6.9 MB.

Pass `splitRequire: false` or `--no-split-require` to keep the old inlined output.

<!-- https://github.com/oven-sh/bun/commit/1a50bfa2c49278715f8b515832fa13cfb4a53de5 -->

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

### Nested classes and functions keep their names in `bun build`

`bun build` no longer renames a class or function in a nested scope from a name like `Abc` to `Abc2` when a top-level binding in the bundle shares its name. `.name` and `constructor.name` now match unbundled code, Node.js, and Rollup.

```ts
const factory = () => {
  class Model {}
  return Model;
};
const Model = factory();
Model.name; // was "Model2", now "Model"
```

A nested binding is still renamed when its scope references the outer name. `--minify` output is unaffected.

`bun build` is also faster on large ESM inputs. Bundling three.js ×100 went from 1.83s in v1.4.0 to 1.12s on Linux x64.

<!-- https://github.com/oven-sh/bun/commit/2a64fab49c5a00f31a29cec8b4c8213294b47d81 -->

## New in `bun build --compile`

### Compiled executables start faster

We added fast paths to Bun's module loader for executables built with `bun build --compile`. Claude Code is compiled with Bun. Its time to the input box dropped 20%, from 397 ms to 318 ms.

![Claude Code time to input box is now 20% faster: 397 ms on version 2.1.250, 318 ms on version 2.1.252. Linux x64, median of 25 interleaved launches.](/images/bun-compile-startup-1.4.1.webp)

<!-- https://github.com/oven-sh/bun/commit/85fba53ade1354a18b0225acb942868439e2f84d -->

### Smaller bytecode

Previously, JavaScriptCore's serialized bytecode was about 9x larger than the source code it parsed from. Packing structs, deduplicating data, and moving data reduced the multiple from 9x to 3x. This made Claude Code's install 45% smaller, from 376 MB to 207 MB.

![Claude Code install size on macOS arm64 is 45% smaller: 376 MB to 207 MB. The bytecode went from 258 MB to 88 MB, and the ratio of bytecode to JS source went from 9 to 1 down to 2.6 to 1.](/images/bun-compile-size-1.4.1.webp)

`--bytecode-depth` is a new option that limits how many levels of nested functions get bytecode ahead of time. Functions past the limit compile on their first call.

```sh
bun build --compile --bytecode --bytecode-depth=1 ./app.ts --outfile app
```

<!-- https://github.com/oven-sh/bun/commit/78526650c398abcc6fd6a324959772d3710a90fb -->

### Cross-compile with `--bytecode`

Cross-compilation with `--bytecode` is now supported. Previously, this did not work when cross-compiling to or from Windows x64 on macOS or Linux.

```sh
bun build --compile --bytecode --target=bun-windows-x64 ./app.ts
```

The bytecode cache format is now the same on every platform, so two builds of the same input produce byte-identical executables.

<!-- https://github.com/oven-sh/bun/commit/65362b53bb13317156aab6c35fb798702de88286 -->

### Smaller text imports in `bun build --compile`

Text imports in a compiled executable are now embedded once in pre-encoded form. JavaScript reads them without parsing or copying.

Previously, a 3 MB ASCII text import added 6 MB to a `--bytecode` binary and 12.6 MB of memory. It now adds 3 MB to the binary and about 1 MB of memory.

```ts
import readme from "./README.md" with { type: "text" };
// no longer parsed as a module or copied onto the heap at startup
```

- Fixed: `import addon from "./x.node"` threw `__require is not defined` in ESM bundles.

<!-- https://github.com/oven-sh/bun/commit/009107248b6c2ddfaed2e49afe2b97dc30013aa7 -->

## New in `bun test`

### `bun test --isolate` no longer leaks between files

Test files that call `mock()`, `spyOn()`, `mock.module()`, or `Bun.plugin()` no longer keep their module graph alive after they finish. Memory under `--isolate` now stays flat as files run.

```sh
bun test --isolate   # 80 files with mocks: 1591 MB -> 215 MB, 1.95s -> 1.46s
```

- `process.env.TZ`, proxy, and TLS settings no longer carry into later test files.
- A file that leaves `monitorEventLoopDelay()` enabled no longer crashes the run.

<!-- https://github.com/oven-sh/bun/commit/8d5689d086c08073f1fdca19d958b48fa2cd35e5 -->

## Other improvements

- Improved: the release `bun` binary is about 1 MB smaller.

<!-- https://github.com/oven-sh/bun/commit/3d3016e329aed0350806fac84eb2930c12009e5b -->

- Improved: `bun -e` uses about 4% less memory and no longer spawns an idle allocator thread.

<!-- https://github.com/oven-sh/bun/commit/861e9ae04bdfd81e8a952664d4a747c33c3bc8d6 -->

- Improved: paused sockets on macOS no longer wake the event loop for every incoming packet.

<!-- https://github.com/oven-sh/bun/commit/c3972cc5c147c7e7a51fcc85dfceda99c8fdadbd -->

- Improved: faster stream consumers, `ReadableStream.from()`, and async-iterable `Response` bodies.

<!-- https://github.com/oven-sh/bun/commit/5227f0c32664cc677883437069625d9145eacd07 -->

- Improved: `WebSocket` clients with `permessage-deflate` use about 12 KB less memory per connection.

<!-- https://github.com/oven-sh/bun/commit/4884409ccf7c385205c88d0be471968e605a8713 -->

- Improved: `Blob.text()`, `Response.text()`, and `TextDecoder.decode()` throw `ERR_MEMORY_ALLOCATION_FAILED` when out of memory, like Node's `Blob.text()` and `Response.text()`.

<!-- https://github.com/oven-sh/bun/commit/f1e5d98865255b2d421e653e95076bb7eb2217fa -->

- Improved: `bun dedupe`, `bun prune --production`, and `bun pm licenses` print clearer output without false warnings.

<!-- https://github.com/oven-sh/bun/commit/3b3687e55ffcad2db0bb9adc08f41bb1f550dd24 -->

- Improved: `bun build --compile` executables ignore `NODE_COMPILE_CACHE` from the environment.

<!-- https://github.com/oven-sh/bun/commit/34396b65d747cd6560bbaa3fdf4b1fc4865fc3ca -->

- Improved: CSS parse errors print the offending token as written, e.g. `@c` or `url(x)` instead of `c` or `x`.

<!-- https://github.com/oven-sh/bun/commit/1beee7ae72de11db41ace9c84e3529c33df211f1 -->

- Improved: hardened `Bun.S3Client` endpoint parsing to match `new URL()`.

<!-- https://github.com/oven-sh/bun/commit/d95bc353ee7e6070bf7d702a248d691b6f873412 -->

- Improved: `@types/bun` accepts every `TextDecoder` encoding label the runtime supports, like `"windows-1251"`.

<!-- https://github.com/oven-sh/bun/commit/6d9d04da1e889465fb610d664ce483f081a26fb6 -->

## Bugfixes

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

### Bun APIs

- Fixed: two `server.upgrade()` bugs inside a `Bun.serve` request handler.
  - After an `await`, it closed `Connection: close` and HTTP/1.0 sockets and leaked the WebSocket.
  - `server.upgrade()` and `ws.close()` ran queued microtasks in the middle of the handler.
- Fixed: a `ServerWebSocket` stalled forever when a large `send()` inside `drain` hit backpressure.

<!-- https://github.com/oven-sh/bun/commit/0823e5059ab1a4c3fa8cb0b8d62a8c82f02b18b4 -->

- Fixed: `Bun.serve()` with HTML routes crashed in two cases

<!-- https://github.com/oven-sh/bun/commit/1b88ad323bcec54ac4328e8ddf112d97ba81002b -->

- Fixed: when a `Bun.serve` handler returned a promise that never settled, an aborted request stayed in `server.pendingRequests` until garbage collection.

<!-- https://github.com/oven-sh/bun/commit/2251d97ed559bf1140014a3c99e18063fad9f8b5 -->

- Fixed: when an async `Bun.serve` handler returned a streaming `Response` after the client disconnected, the stream was not cancelled.

<!-- https://github.com/oven-sh/bun/commit/936bf867aa6d7a0e8daa766aec309943b24c4e97 -->

- Fixed: `Bun.serve` could crash when the client disconnected while the handler was still running and its promise settled later.

<!-- https://github.com/oven-sh/bun/commit/a4ed5948b88d5db5aa98ce212c1fe75dc5b1a9ed -->

- Fixed: `Bun.serve` mishandled responses whose body stream failed.
  - A body stream that errored before its first byte was sent as a complete, empty response.
  - In rare cases, a handler that returned a proxied `fetch()` response hung instead of running `error()`.

<!-- https://github.com/oven-sh/bun/commit/ec70edb0da40f4c6beacb630b533c359bc83cb35 -->

- Fixed: `Bun.serve` accepted malformed `Range` headers with signed or `_`-separated positions.

<!-- https://github.com/oven-sh/bun/commit/b026de3f27013473fa5dd77f78a15a368a27139d -->

- Fixed: `Bun.serve({ app })` accepted wrong-typed options instead of throwing `ERR_INVALID_ARG_TYPE`.

<!-- https://github.com/oven-sh/bun/commit/747ba4e865f5513abb6f226bce4c75faa385ad6b -->

- Fixed: `Bun.serve` and `Bun.listen` threw a misleading `ENOENT` for a malformed hostname.

<!-- https://github.com/oven-sh/bun/commit/b5d0bbc0edd90c46b29eb8273bc272a7042e584b -->

- Fixed: `Bun.file(p).slice(a, b)` sent the whole file when its unread `.stream()` was passed to a `Response` or `bytes()`. It also sent the wrong bytes when used as a `Bun.serve` route.

<!-- https://github.com/oven-sh/bun/commit/a28f82980f9c6b149cc1f1dca62c0a530962f1c8 -->

- Fixed: `blob.writer()` and `writer.start()` silently ignored an invalid `path` or `fd` option.

<!-- https://github.com/oven-sh/bun/commit/44411167ac71636af587865b2ccd78318fa8349d -->

- Fixed: `Bun.sha()` silently ignored an invalid `output` argument instead of throwing.

<!-- https://github.com/oven-sh/bun/commit/36e2480c4803a5eec5c9c6f8416fe5bb6ab2e018 -->

- Fixed: `Bun.CSRF` threw `TypeError` instead of `RangeError` for out-of-range `expiresIn` and `maxAge`.

<!-- https://github.com/oven-sh/bun/commit/82f4e4483147f2bff3055efa44d1af484be28db8 -->

- Fixed: `Bun.YAML.stringify` with an indent put boxed `Number` and `Boolean` values on the line after their key.

<!-- https://github.com/oven-sh/bun/commit/fbc79360f761b3ba4a9ebe06871099681ae7a0d9 -->

- Fixed: JSON5 errors for bad `\x` and `\u` escapes reported the wrong column.

<!-- https://github.com/oven-sh/bun/commit/d578a8c70d103dd11c75cf3c8b681d4a015a66df -->

- Fixed: on the Chrome backend, closing a `Bun.WebView` created with a `url` option raised an uncatchable `WebView closed` rejection.

<!-- https://github.com/oven-sh/bun/commit/70736fdb2ebf4080b010c3a9958cbf4804696dea -->

- Fixed: `Bun.WebView` (WebKit backend) hung on `navigate()` after 64 views in one process.

<!-- https://github.com/oven-sh/bun/commit/af0d89d650bf31d20c11213f167165c058dd5b40 -->

- Fixed: `Bun.Image` on macOS turned undecodable HEIC files into black images and rejected 10-bit HEIC.

<!-- https://github.com/oven-sh/bun/commit/fe560814784973f4bdabdcdec6636f8ea610a193 -->

- Fixed: an intermittent JIT bug, mostly seen on Windows, when optimized code passed an `ArrayBuffer` to a `bun:ffi` pointer argument.

<!-- https://github.com/oven-sh/bun/commit/5079e5e39d1c4e1da0e074aa0685f13d8a9dff66 -->

- Fixed: `toBuffer()` and `toArrayBuffer()` from `bun:ffi` returned argument errors instead of throwing them.

<!-- https://github.com/oven-sh/bun/commit/fd7d527db8f932ae6d0f662a56fc511447c58763 -->

- Fixed: on macOS and Linux, `Bun.serve` buffered a FIFO, socket, or device `Bun.file()` response body without limit when the client wasn't reading, sometimes crashing if the client then disconnected.

<!-- https://github.com/oven-sh/bun/commit/c2a2b28b353bbb67aa8d1694144c7eb395048744 -->

- Fixed: with `--splitting`, `Bun.serve` returned 404 for assets imported only by a module that an HTML import loads via dynamic `import()`, and for the lazy chunks themselves when there were two or more HTML imports.

<!-- https://github.com/oven-sh/bun/commit/2ce05ce463fb84251f86824b060fd414c87a0692 -->

### Web APIs

- Fixed: `fetch()` with a `timeout` of 4 seconds or less aborted requests early with `TimeoutError`, a regression in 1.4.0.

<!-- https://github.com/oven-sh/bun/commit/24944aad41b1c60d0fee554be75ad838a3f6d71b -->

- Fixed: `fetch()` with `tls.checkServerIdentity` opened a new TLS connection for every request, a regression in 1.4.0.

<!-- https://github.com/oven-sh/bun/commit/4d62789da1ab071a45fe03d89fef0a81f736e2e0 -->

- Fixed: `fetch()` gave 204, 205, 304, and HEAD responses a non-null `body`, so `clone()` threw after reading.

<!-- https://github.com/oven-sh/bun/commit/77afa71e9dad138db2d652b932f454cf07147867 -->

- Fixed: `new Response(asyncGenerator)` appended the generator's `return` value to the body.

<!-- https://github.com/oven-sh/bun/commit/acd342244f1e33866115453abe30fe31e65574b0 -->

- Fixed: `Headers` rejected non-ASCII latin-1 values from `JSON.parse` or `.normalize()`.

<!-- https://github.com/oven-sh/bun/commit/cb925f64ef41965928c39e206e29d269f170be6a -->

- Fixed: a streamed `fetch()` response could lose the end of its body with `ECONNRESET` when the server closed while the client was still uploading, a regression in 1.4.0.

<!-- https://github.com/oven-sh/bun/commit/f8b3cf06b0fa4eaf9800c7f810d1f0e32bebea3c -->

- Fixed: `new WebSocket("ws://[::1]:PORT")` sent a `Host` header without the port.

<!-- https://github.com/oven-sh/bun/commit/a1c1d4ac08580cd6513fb72738b6fff64add1a42 -->

- Fixed: `ws` `handleUpgrade()` threw a `TypeError` when called after an `await`, a regression in 1.4.0.

<!-- https://github.com/oven-sh/bun/commit/64092d4c607b622b227fff1be40437d570b75527 -->

- Fixed: a rare crash when a `wss://` WebSocket through a proxy closed mid-write.

<!-- https://github.com/oven-sh/bun/commit/ae421357665061c5567df56a888d96bc48bf6e37 -->

- Fixed: in rare cases, `pipeTo()` and BYOB `read()` threw synchronously instead of returning a rejected promise.

<!-- https://github.com/oven-sh/bun/commit/b30c6ff98629ae9049431ebf1a4d3b550058b94f -->

- Fixed: `TextEncoderStream` crashed on a huge chunk instead of throwing an out-of-memory error.

<!-- https://github.com/oven-sh/bun/commit/db059d8ff09f726efd0d042851b96279f3c72898 -->

- Fixed: `new TextDecoder("utf-8", { ignoreBOM: 1 })` threw instead of coercing to a boolean.

<!-- https://github.com/oven-sh/bun/commit/69c613875cddf32e3f3060735e39a0060a0d469b -->

- Fixed: `crypto.subtle` RSA-PSS accepted `saltLength` values near 2^32 instead of rejecting them with `OperationError`.

<!-- https://github.com/oven-sh/bun/commit/b4e645c60ac0e5405aa4a102589798e39505d3d5 -->

- Fixed: `JSON.stringify(performance.mark())` omitted `detail` unless `node:perf_hooks` was loaded.

<!-- https://github.com/oven-sh/bun/commit/7769b1019e8016a11d2402b4561d2a502709a78f -->

- Fixed: `clearTimeout()` did nothing when the timer id was an integer stored as a float, such as one read from a `Float64Array` or returned by `Math.sqrt()`.

<!-- https://github.com/oven-sh/bun/commit/6fb710252675a8b2c0a6b6fa963fc0c0ca67c4b5 -->

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

### JavaScript minifier

- Fixed: in rare cases `Bun.build({ minify: true })` produced different identifier names across identical builds of a project with `sideEffects: false` barrel files.

<!-- https://github.com/oven-sh/bun/commit/3777bf0fa70bbfca4a7c1e0bdc25d850ddc78ceb -->

### CSS Parser

- Fixed: `bun build` warned on valid `::details-content`, `::picker()`, `::checkmark` and `::picker-icon` selectors.

<!-- https://github.com/oven-sh/bun/commit/b7039c9fe7889a97863350ae69397220a899e300 -->

- Fixed: CSS modules did not scope `view-transition-name` and `::view-transition-group()` names.

<!-- https://github.com/oven-sh/bun/commit/f170b9c0de27b6fa7c3503831a4eedab17ec008d -->

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

### SQL / SQLite / S3 clients

- Fixed: `Bun.sql` decoded Postgres `float8` and `float4` `Infinity` values as `NaN` in text-format results, such as `.simple()` and `sql.unsafe()` without parameters.

<!-- https://github.com/oven-sh/bun/commit/79bc383614fddae15d4d299c8fa615ff875617c0 -->

- Fixed: `Bun.sql` returned `Invalid Date` in `.simple()` queries and arrays for Postgres `timestamptz` values with a seconds offset, like `-04:56:02` for pre-1900 dates.

<!-- https://github.com/oven-sh/bun/commit/f2fe7d32499962c2974e7d018730fea7265ef60d -->

- Fixed: `Bun.sql` could crash when `close()`, `ref()`, or `unref()` ran after the server had already dropped the connection.

<!-- https://github.com/oven-sh/bun/commit/94579a1d7478845d721bd70457ad4435e32a8fc6 -->

- Fixed: `sql.close()` fired `onclose` for pool connections that never connected.

<!-- https://github.com/oven-sh/bun/commit/fea2bc16de8ad7cf32542d85cf63d8851b39108b -->

- Fixed: `Bun.sql` stored `Date` values in MySQL `TIMESTAMP` columns at the wrong instant when the session time zone was not UTC.

<!-- https://github.com/oven-sh/bun/commit/dc890ebec98506905d8ec1d1afa9b850d35dffaa -->

- Fixed: in `bun:sqlite`, `db.prepare()` with params crashed on SQL that held no statement (only whitespace, comments, or `;`) instead of throwing `Invalid SQL statement`.

<!-- https://github.com/oven-sh/bun/commit/f189103280cff2f0e06f555bc85b41eb2dd0e1cb -->

- Fixed: a streaming S3 upload from a `ReadableStream` could fail if garbage collection ran while the upload waited for a part to finish.
  - The upload could crash or hang.
  - A later error from the source stream was lost.

<!-- https://github.com/oven-sh/bun/commit/a6c4cc276b8b611b10f44546940feb7a891c7caf -->

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

## Thanks to 7 contributors!

- [@alii](https://github.com/alii)
- [@dylan-conway](https://github.com/dylan-conway)
- [@jarred-sumner](https://github.com/jarred-sumner)
- [@jvitormelo](https://github.com/jvitormelo)
- [@marshallofsound](https://github.com/marshallofsound)
- [@robobun](https://github.com/robobun)
- [@sosukesuzuki](https://github.com/sosukesuzuki)
