---
source: https://bun.com/blog/bun-v1.4.3 (markdown: https://bun.com/blog/bun-v1.4.3.md)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504 (docs repo HEAD at fetch time; blog posts are not in oven-sh/bun, fetched from bun.com)
---

# Bun v1.4.3

> Fixes 166 issues, addressing 122 👍. bun check, a TypeScript type checker built into Bun that is 3x to 6.4x faster than tsc 7, --check for bun run, bun build and bun test, 67–89% less idle CPU, Bun.FetchSession, experimental Bun.ModuleGraph, --disallow-code-generation-from-strings, up to 2.7x faster large node:http responses, a JavaScriptCore upgrade with faster JSON.parse, faster rejected-promise handling, CompressionStream compression levels, If-Range support in Bun.serve, bun install skips tarballs it won't install, lower bun build memory with many entry points, [hashN] output names, profile-guided bytecode layout and faster startup for --compile --bytecode, and many bugfixes and Node.js compatibility improvements.

_Excerpt: kept whole sections on Node.js compatibility, bun install, bun test, upgrading/breaking changes, developer experience/processes, plus any subsection mentioning install/linker/lockfile/trustedDependencies/node_modules/workers/fs.watch/argv/preload/bunfig/BUN_OPTIONS/child_process/jest/mocks. Full verbatim post: see blog-full/ in this directory._


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

### Experimental: `Bun.ModuleGraph`

Run many instances of one app in a single process. Each graph gets fresh module state, its own `require.cache`, and its own timers and I/O. Parsed code and bytecode are shared between graphs.

```ts
const graph = new Bun.ModuleGraph({
  globals: { process: tenantProcess },
  onError: (error, kind) => console.error(kind, error),
});

const app = await graph.import("./app.ts");
await graph.run(() => app.handle(request));

graph.dispose(); // closes the graph's servers, sockets, timers, child processes
```

- `graph.run(fn, ...args)` calls `fn` in the graph's context, so what it opens belongs to the graph.
- `graph.dispose()` (or `using`) behaves like `worker.terminate()`. It is not a security sandbox.
- `Bun.ModuleGraph.current` is the graph whose context the caller is in.

<!-- https://github.com/oven-sh/bun/commit/0d3492e353f38ced6288b5b6fb27724d66b588f3 -->

### `--disallow-code-generation-from-strings` blocks `eval()` and `new Function()`

With Node's `--disallow-code-generation-from-strings` flag, `eval()` and `new Function()` throw. It covers the whole process, including every `Worker`. Bun used to accept the flag and ignore it.

```ts
new Function("return 1 + 1");
// EvalError: Code generation from strings disallowed for this context
```

`=strict` is Bun-only. It also blocks every other way a string becomes code: `node:vm`, `import()` of a `data:` URL, `new Worker(code, { eval: true })`, `module._compile()`, plugins that return source text, `napi_run_script()` and the inspector.

A flag embedded in a compiled executable always applies. `BUN_OPTIONS` can raise the level but not lower it.

```sh
$ bun build --compile ./server.ts --outfile server \
    --compile-exec-argv="--disallow-code-generation-from-strings=strict"
```

<!-- https://github.com/oven-sh/bun/commit/b253e8afbc1fad3dfc65c141ba986eb914323dfe -->

## New in `bun install`

### `bun install` skips tarballs it won't install

Without a lockfile, `bun install` and `bun add` no longer download tarballs for packages that never land in `node_modules`: bundled dependencies, packages for other platforms, and groups turned off by `--production` or `--omit`.

Tarballs downloaded with a cold cache and no lockfile:

| Install                              | After | Before |
| ------------------------------------ | ----: | -----: |
| `npm@10.9.2`                         |     1 |    196 |
| `express` + dev deps, `--production` |    69 |    403 |

<!-- https://github.com/oven-sh/bun/commit/8eaad800c77e2776cdcd32334a1c08acf994a7df -->

## New in `bun build`

_(parent section; only matching subsections kept)_

### Lower memory usage in `bun build` with many entry points

Builds with many entry points or chunks use much less memory.

| Peak RSS, 800 entry points                                             |  After |   Before |
| ---------------------------------------------------------------------- | -----: | -------: |
| Each imports one export from a file with 200,000 exports, `--splitting` | 276 MB | 2,121 MB |
| 13 modules each, with or without `--splitting`                          | 200 MB |   405 MB |

This fixes a regression from Bun v1.4.1 where `bun build --splitting` with ~800 chunks peaked at 7.7 GB instead of 6.2 GB. On Windows, it could abort with `memory allocation of N bytes failed`.

<!-- https://github.com/oven-sh/bun/commit/0b7b77e66e72d6bde1a0fc202551f2be9747f23b -->

## Bugfixes

_(parent section; only matching subsections kept)_

### Node.js compatibility improvements

#### `node:http`

- Fixed: after `req.pause()` in a `node:http` server, a small body was not received until `req.resume()`, so `req.complete` stayed `false` and `req.readableLength` stayed `0` while paused.
- Fixed: in a `node:http` server, `res.end()` before the request body had arrived made `req` emit `'end'` at once and dropped the rest of the body. A handler that read the body first was unaffected.
- Fixed: in a `node:http` server, a synchronous `res.destroy()` in the `'request'` listener or a `'data'` listener, while the request body was still arriving, made `req` emit `'end'` with `req.complete === true` instead of `'aborted'` and `ECONNRESET`.
- Fixed: `'finish'` and the `res.end()` callback on a `node:http` response fired before the last bytes left the socket. This needed a response too large for the kernel's socket buffer and a client that was slow to read it.
- Fixed: a `node:http` response never emitted `'drain'` when `res.write()` had returned `false` and other code, such as a heartbeat timer, called `res.write()` again just as the client caught up. A `stream.pipe(res)` on that response then hung.
- Fixed: a `node:http` server never answered a pipelined request when part of its body arrived after the previous response had ended.
- Fixed: `server.close()` on a `node:http` server called back once in-flight responses finished, while their keep-alive connections were still open and serving requests. `closeAllConnections()` after `close()` did nothing, so an open connection kept the process alive.
- Fixed: `server.closeAllConnections()` also stopped the listener and destroyed tunnels and WebSockets.
- Fixed: writes to a `node:http` `'upgrade'` or `'connect'` socket stayed buffered until `socket.end()` when the same keep-alive connection had already served a request. The npm `ws` package stalled this way. Fresh connections were unaffected.
- Fixed: CONNECT and Upgrade tunnel sockets kept reading while paused.
- Fixed: a `node:http` `'connect'` or `'upgrade'` listener that called `socket.end()` missed part of the data the client had sent right behind the request. This needed request headers that arrived in more than one read, with more than 17 KB of data behind them.
- Fixed: a `node:http` server dropped the body of a HEAD or TRACE request that declared one with `Content-Length`.
- Fixed: `Proxy-Connection: close` now closes the connection, like `Connection: close`.
- Fixed: HTTP/1.0 requests with an `Expect` header get a plain `'request'`, not `100 Continue`.
- Fixed: servers fed a socket through `server.emit("connection", duplex)` or http2's `allowHTTP1` fallback threw `ERR_HTTP_SOCKET_ASSIGNED` on pipelined or fast keep-alive requests.
- Fixed: `req.setTimeout()` never fired when a pipelined request's body stalled behind a pending response. The server closed the socket instead.

<!-- https://github.com/oven-sh/bun/commit/838da266204547c3f3b1f04d51eca435c4bb7e97 -->

- Fixed: `node:http` `server.close()` never called back when a request body finished arriving while the `IncomingMessage` was paused, the response ended later, and the same keep-alive connection then served another request.

<!-- https://github.com/oven-sh/bun/commit/6b394bfeb0ce69d6668a8aecb648b5c5b2fc6cbf -->

- Fixed: calling `listen()` on a `node:http` server that was already listening leaked the first listener and kept the process alive after `close()`. It now throws `ERR_SERVER_ALREADY_LISTEN`, like Node.

<!-- https://github.com/oven-sh/bun/commit/542f52be3d60426c83e817280c62f8433c420bda -->

- Fixed: `node:http` servers emitted `'clientError'` repeatedly for the same stalled request (eventually triggering `MaxListenersExceededWarning`) when the listener didn't destroy the socket after a `headersTimeout` or `requestTimeout`.

<!-- https://github.com/oven-sh/bun/commit/5da0350a5dfb4ec09e6bfb74099e2da77d997ca6 -->

- Fixed: in `node:http` servers, `req.socket` emitted only `'close'` when the client closed the connection, never `'end'` for a FIN or `'error'` (`ECONNRESET`) for a reset.
- Fixed: `req.socket.setKeepAlive()` and `req.socket.resetAndDestroy()` in a `node:http` server returned `undefined` instead of the socket, so chaining threw.

<!-- https://github.com/oven-sh/bun/commit/6d99e4b542407f69c9fcf04c5833be5b9b64e45d -->

- Fixed: a `node:http` server that called `res.detachSocket()` on an unfinished response could, in rare cases, crash on a later use of that response, or never exit, after the client disconnected. Regression since v1.4.0.

<!-- https://github.com/oven-sh/bun/commit/7903ab6162e6b6c45f5fbdb8b497894b86eb4966 -->

- Fixed: `node:http` and `node:https` proxy errors (`ERR_PROXY_TUNNEL`, `ERR_PROXY_INVALID_CONFIG`) included the username and password from the proxy URL.

<!-- https://github.com/oven-sh/bun/commit/6e2c74ad34084e20839e251bf7fc1fc7ea699179 -->

- Fixed: a proxied `node:https` request (`new https.Agent({ proxyEnv })`, `NODE_USE_ENV_PROXY=1`) emitted `'close'` but never `'error'` (`ECONNRESET`) when the connection ended after the proxy accepted `CONNECT` but before the TLS handshake finished.

<!-- https://github.com/oven-sh/bun/commit/e70cca7d10679dffafe6c301ee9844c36bdd6efb -->

#### `node:http2`

- Fixed: on Linux, `http2.connect()` to a closed port reported `ECONNRESET` instead of `ECONNREFUSED`. With no `'error'` listener, the failure was silently swallowed. Regression since v1.4.0.
- Fixed: a `node:http2` request with `[http2.sensitiveHeaders]` also sent a literal `nodejs.http2.sensitiveheaders` header that listed those header names. `Bun.spawn` env and macros also turned Symbol keys into string keys.
- Fixed: `node:http2` ALTSVC and ORIGIN frames used UTF-8 instead of latin-1, so a value containing bytes 0x80 to 0xFF read differently on a Node.js peer. ASCII values were unaffected.
- Fixed: `http2.connect()`, `createServer()` and `createSecureServer()` accepted invalid options that Node rejects, such as a non-boolean `strictSingleValueFields`.
- Fixed: `ClientHttp2Stream.close(code)` emitted `error` for `NGHTTP2_CANCEL`, and `end` before `error` for other error codes.
- Fixed: `session.originSet` threw after `destroy()` on a TLS session that had never read it. It now returns `undefined`, like Node.

<!-- https://github.com/oven-sh/bun/commit/61cdc7a5e105be873a5782868c3e88236d27e4c7 -->

#### `node:tls`

- Fixed: `tls.Server#setSecureContext()` had no effect on a server that was already listening.
- Fixed: `tls.Server#addContext()` and `Bun.serve({ tls: [{ serverName }] })` served the default certificate for a hostname with an unusually large number of labels. An `addContext()` wildcard also did not cover the hostname passed to `listen()`.

<!-- https://github.com/oven-sh/bun/commit/754ea3426160f71b5979d0f6cb147a47c8edf514 -->

- Fixed: client-side `new tls.TLSSocket(socket)` (STARTTLS) never started a handshake. `write()` threw a `TypeError` and `_start()` threw `ERR_MISSING_ARGS`. The `mysql` package connects this way when `ssl` is set.
- Fixed: after `tls.connect({ socket })`, `'data'` listeners left on the plain socket kept firing with the encrypted bytes. A STARTTLS listener that called `tls.connect({ socket })` on every chunk got `Invalid socket` from the second call.
- Fixed: a TLS socket that wraps a `net.Socket` ignored the wrapped socket's `allowHalfOpen`. A STARTTLS server created with `net.createServer({ allowHalfOpen: true })` could not reply after the client ended its side.
- Fixed: a `net.Socket` wrapped by `new tls.TLSSocket(socket)` or `tls.connect({ socket })` emitted its own `'error'` on a peer reset, and `'end'` and `'finish'` on `tlsSocket.destroy(err)`, on top of the TLS socket's events. Node emits only `'close'` on the wrapped socket.
- Fixed: destroying a `tls.connect({ socket })` client in the same tick it was created left the wrapped `net.Socket` open, with no FIN sent, if that socket still had unflushed writes.

<!-- https://github.com/oven-sh/bun/commit/158ff6cdefa281a2039c82f08044e0fc0b6755c2 -->

- Fixed: when a `node:tls` socket ran over a plain `stream.Duplex` (not a `net.Socket`), destroying the `Duplex` with an error threw an uncaught exception instead of emitting `'error'` on the TLS socket. An `https.request` over such a socket exited the process.
- Fixed: a server-side `tls.TLSSocket` over a `Duplex` emitted `ECONNRESET` and no `'close'` when the `Duplex` was destroyed before the handshake finished. If it was destroyed in the same tick as the wrap, the TLS socket emitted nothing.
- Fixed: in an uncommon configuration, a `node:tls` server over a `Duplex` whose `ALPNCallback` writes to the socket, the server could crash during the handshake.
- Fixed: `end()` on a `node:tls` socket over a `Duplex` never ended the `Duplex` (the peer saw no FIN) if the peer stalled mid-handshake or never answered the TLS close.

<!-- https://github.com/oven-sh/bun/commit/01123b4ef0f5f5568a6a9139f781ed33c3053a40 -->

- Fixed: `tls.TLSSocket` `end()` and `destroySoon()` sent no FIN when the peer never answered the TLS handshake, so the socket never emitted `'close'`.
- Fixed: an accepted `node:tls` socket whose peer reset the connection during a large write could emit only `'end'`, never `'error'` or `'close'`, so `server.close()` never completed. This was seen on Linux and depended on timing.

<!-- https://github.com/oven-sh/bun/commit/44e51b7f4b2c43e4e133dc5bf85e906a3433e018 -->

- Fixed: a `tls.connect()` or `node:https` client that wrote before a TLS 1.3 handshake finished could get `ECONNRESET` instead of the reply. This needed a server without `noDelay` that reset the connection a few milliseconds after replying.

<!-- https://github.com/oven-sh/bun/commit/6b877b47b392c6c72414db216f699a536a92f925 -->

#### `node:net` and `node:dns`

- Fixed: a `node:net` socket could drop or resend bytes after a partial `writev()`. This needed a peer that had stopped reading, data already buffered for it, and a new write that the kernel accepted only part of.
- Fixed: `net.Socket#write()` returned `true` when the send failed immediately (`ECONNRESET`, `EPIPE`, or a closed handle). It now returns `false` and sets `socket.errored`, matching Node.

<!-- https://github.com/oven-sh/bun/commit/fd4068f9cd0caaea8e9cf0a32402eb1db4cbc032 -->

- Fixed: `node:net` routed an exception thrown in a socket `'data'` or server `'connection'` listener to the socket's `'error'` event and closed the socket, instead of `uncaughtException` like Node.

<!-- https://github.com/oven-sh/bun/commit/c2bf9b414c6c602629330ea8f68f3967de146cd5 -->

- Fixed: a `node:net` or `node:tls` socket was never garbage collected if it was destroyed before its connection attempt started (in the same tick as `connect()`, or during the DNS lookup), or if its DNS lookup failed.

<!-- https://github.com/oven-sh/bun/commit/367d939d9afc919c6ccce278c970e7c3f23da8c9 -->

- Fixed: `new net.Socket({ fd, readable: false, writable: true })` ended and closed the fd one tick after construction, so later writes failed with `EPIPE`.

<!-- https://github.com/oven-sh/bun/commit/e88d46d823d17304ebe961529a5feeb16d54160a -->

- Fixed: `fetch()`, `Bun.connect()` and `dns.lookup()` (on macOS and Windows, or with the `system`/`libc` backend) reported a temporary DNS failure (SERVFAIL or every nameserver timing out) as `ETIMEOUT` instead of `EAI_AGAIN`, so retry logic keyed on `EAI_AGAIN` never fired.

<!-- https://github.com/oven-sh/bun/commit/07f629a4c6c7b6d9ccc07c18cd25a126dc7411e0 -->

#### `node:child_process`

- Fixed: on Linux and macOS, with `child_process.spawn()` and an `"ipc"` stdio slot, a non-JS child (e.g. Python) that wrote a message larger than the socket buffer in one `write()` got a short write, and the message never arrived.
- Fixed: `child_process.spawnSync()` of a command that can't be spawned returned `status: undefined`, `pid: undefined` and `output: [null, null, null]`. It now returns `status: null`, `pid: 0` and `output: null`, like Node.

<!-- https://github.com/oven-sh/bun/commit/091a025fa182c2f1bea50990aa9057e4559559a0 -->

- Fixed: `child.stdin.end(cb)` and `tty.WriteStream#end()` called with no data fired `cb` and `'finish'` while earlier writes still waited on a full pipe. A parent that exited in `cb` truncated the child's input. `end(chunk, cb)` was not affected.

<!-- https://github.com/oven-sh/bun/commit/c29251f005b236d1958eb57c0855515d7c3bc3ef -->

- Fixed: `child_process.spawn()` now throws `ERR_INVALID_ARG_VALUE` when `stdio` holds a `tls.TLSSocket`, like Node.js.

<!-- https://github.com/oven-sh/bun/commit/3d390b77b74109c96c7b964a181bf7bd34376e99 -->

- Fixed: calling `destroy()` inside a `'data'` listener on `child.stdout`, `child.stderr`, or a `Readable.fromWeb()` stream emitted one more `'data'` (and sometimes `'end'`). `exec()` with `maxBuffer` could overshoot the limit by a chunk. Regression in v1.4.0.

<!-- https://github.com/oven-sh/bun/commit/80825a7a878393b950e9efc773b9913a1ed496aa -->

#### `node:module`

- Fixed: `require()` and `require.resolve()` crashed when `Module._resolveFilename` was set to a non-function. They now throw a `TypeError`, like Node.
- Fixed: `require()` of an ES module crashed when code had replaced `Module._resolveFilename` with its own function, and that function returned a path that was not normalized (a symlink, or one containing `/./`, `/../` or `//`).

<!-- https://github.com/oven-sh/bun/commit/4a1b32f46a646d358146e694460981299044be9a -->

- Fixed: the second `require()` of an ES module threw if a `Module._extensions` handler had called the original loader and caught the module's error. The module was dropped from `require.cache`.

<!-- https://github.com/oven-sh/bun/commit/2722608f474a2d9468e9d1ac3a1eb2fe6e630901 -->

- Fixed: Bun crashed when a preload set `Module.runMain` to a non-function such as `{}` or a string. An override that threw printed only `Error occurred loading entry point: JSError`, without the error.

<!-- https://github.com/oven-sh/bun/commit/76cf78c58aafe4b9852af3fc5b4ec3b1cab6b513 -->

#### `node:vm`

- Fixed: when the host passed its `File` or `fs.Stats` class into a `node:vm` context, `class Upload extends File {}` there crashed on `new Upload(...)`. A host `PerformanceObserver` whose callback was created in a context crashed when it delivered entries.
- Fixed: `vm.runInContext()`, `vm.runInNewContext()` and the matching `vm.Script` methods crashed instead of throwing a `TypeError` when an option such as `displayErrors` was given a null-prototype object that had a custom `util.inspect` function.
- Fixed: `node:vm` aborted the process, even inside `try`/`catch`, when text it built from JS, such as `compileFunction()` parameters or a thrown error's `stack`, passed the maximum string length of 2^31 - 1 characters.

<!-- https://github.com/oven-sh/bun/commit/ebc8daee04d0caccc3e78bbc3554b12af10d72c0 -->

- Fixed: a `vm.Script`, `vm.compileFunction` or `vm.SourceTextModule` kept its context alive for the life of the process when its `importModuleDynamically` callback could reach that context (such as a closure over the sandbox) and the code left a function on it.

<!-- https://github.com/oven-sh/bun/commit/85615fbb5a6067cd2fa551ce6bf2f9c7b2738f5a -->

- Fixed: in a `node:vm` context, the `TypeError` thrown when `Object.defineProperty` on the global failed was created in the host realm instead of the context's realm.

<!-- https://github.com/oven-sh/bun/commit/8547bdeaa4acc3303b24f6ecf9e4d85f250b11a1 -->

#### `node:fs`

- Fixed: on Linux and macOS, `node:fs` opened files without `O_CLOEXEC`. Child processes forked by native code, such as `node-pty` or an addon calling `system()`, inherited those descriptors. Children of `Bun.spawn` and `node:child_process` did not.

<!-- https://github.com/oven-sh/bun/commit/ebfad4cda70f67dfa60f0ee8eb3158d2e11d488d -->

- Fixed: inside a `node:fs` callback, a microtask the callback queued ran before a `process.nextTick()` it queued. The order now matches Node.

<!-- https://github.com/oven-sh/bun/commit/fe927c3a903b25f02b65ccbac5ed5c377fbed93f -->

- Fixed: `fs.readSync()` and `fs.read()` threw `ERR_OUT_OF_RANGE` instead of Node's `ERR_INVALID_ARG_TYPE` when `buffer` was not a buffer and `offset` was invalid.

<!-- https://github.com/oven-sh/bun/commit/e8750e3dc0d88c2fe1ac37b5f016387ad28114cf -->

#### `node:util`

- Fixed: `util.format('%s', value)` printed the `util.inspect()` output (such as `<Buffer 61 62>`) for `Buffer`, `URL`, and `URLSearchParams`. It now prints their `toString()` result, as Node does.

<!-- https://github.com/oven-sh/bun/commit/4593030feca2e140405007aec3195953ae9558a9 -->

- Fixed: every garbage-collected `MIMEType` from `node:util` leaked its `type` and `subtype` strings. That was about 57 bytes per instance for a `text/html` type with a `charset` parameter.

<!-- https://github.com/oven-sh/bun/commit/aecbe190f146bd2f9539e0b221e59a7d2f7505e5 -->

- Fixed: `util.aborted()` invoked a user-replaced `Function.prototype.bind` on its internal abort listener.

<!-- https://github.com/oven-sh/bun/commit/bec98aae9646bfde0ca8438f58643a6cb6c6d14c -->

- Fixed: after a few hundred `util.promisify()` calls, `util.promisify(setTimeout)` could return the promise version of `setImmediate` or `setInterval` if that timer was promisified first, so `await sleep(300)` resolved at once. Regression in v1.4.1.

<!-- https://github.com/oven-sh/bun/commit/c5a68b05942267c8346f98a13ca5ab6118144f75 -->

#### `node:crypto`

- Fixed: in `node:crypto`, `hash.update()` after `hash.end()`, which throws in Node.js, hung forever on `sha3-*` hashes. `hash.end()` after `digest()`, as when `pipe()` ends a hash whose `digest()` was already called, emitted `ERR_CRYPTO_HASH_FINALIZED` instead of the digest.

<!-- https://github.com/oven-sh/bun/commit/e5f9986a4c185adc02260bc469a4c661b806e2ec -->

- Fixed: `crypto.hkdfSync()` and `crypto.hkdf()` returned an empty `ArrayBuffer` for a `keylen` of 0 instead of failing with "HKDF derivation failed", as Node.js does.

<!-- https://github.com/oven-sh/bun/commit/6a6a1e3121684f11c0671f45319477756b61173a -->

#### `node:buffer`

- Fixed: `buffer.transcode()` aborted the process, even inside `try`/`catch`, when its output needed 2 GiB or more.

<!-- https://github.com/oven-sh/bun/commit/75c47c0dbfb986be814af543b6063567b200c648 -->

- Fixed: `buf.utf8Write(123)`, `buf.hexWrite(123)` and the other per-encoding `Buffer` write methods wrote the string form of a non-string value. They now throw `ERR_INVALID_ARG_TYPE`, like Node.js.

<!-- https://github.com/oven-sh/bun/commit/aa8307619d8dccbda113a5a4aa1885e0cef7eaba -->

#### Native addons

- Fixed: when the main thread or a Worker exited naturally, a native addon's N-API finalizers and cleanup hooks could still call into JavaScript, and that JavaScript could call a second addon that was already torn down. These calls now return `napi_cannot_run_js`, like Node.js.

<!-- https://github.com/oven-sh/bun/commit/b841a68a6cd77bb74ef36ead54c7da8d7907a146 -->

- Fixed: native addons that call `v8::Function::GetScriptOrigin()`, such as `@newrelic/fn-inspect`, failed to load on Linux and crashed on macOS.

<!-- https://github.com/oven-sh/bun/commit/2ffa89119efea945e7921559169ca728cbd654bc -->

#### Other modules

- Fixed: `node:wasi` `poll_oneoff` threw `TypeError: Invalid mix of BigInt and other type in subtraction` on any clock wait with a positive timeout, so a WASI `sleep()` failed.
- Fixed: `node:wasi` `fd_pread` reported twice the bytes read whenever a read filled its buffer.
- Fixed: `require("cluster")` threw `cluster._setupWorker is not a function` when a script set `process.env.NODE_UNIQUE_ID` itself after `node:net` had loaded.
- Fixed: `node:dns` and `AsyncLocalStorage.bind()` argument errors read `The "undefined" argument must be of type ...` instead of naming the argument.

<!-- https://github.com/oven-sh/bun/commit/4af1842c8cd9ada51dfa49afa79d57729707aaef -->

- Fixed: response bodies from an installed copy of Undici could stay pending instead of rejecting after a forced socket close, because `node:stream`'s `isReadable()` returned `null` for web `ReadableStream`s.

<!-- https://github.com/oven-sh/bun/commit/cadd8dbea3be6acbfe539b57bdfaa7db829d2ef9 -->

- Fixed: `for await (const line of rl)` over `node:readline` threw `ERR_USE_AFTER_CLOSE` and dropped the last line when the input ended with a single chunk of 1,026 or more lines. This hit `Readable.from([text])` and HTTP responses, not files, stdin or child process output. Regression in v1.4.0.

<!-- https://github.com/oven-sh/bun/commit/708bff2da688f3f43de171a76f336051673ac907 -->

- Fixed: in `node:quic`, `sendHeaders()` on a stream opened before the handshake finished was not sent until the client wrote a body or ended the stream.

<!-- https://github.com/oven-sh/bun/commit/403f36daa99cb25b26a5a0aa42bbf1e75693a0d4 -->

- Fixed: `url.parse()` and `url.resolve()` crashed instead of rethrowing when they were passed an object instead of a string and a getter on that object (like `constructor`) threw a primitive value.

<!-- https://github.com/oven-sh/bun/commit/a8e4e904233d0455017d5d7ae116b90a53159020 -->

- Fixed: `class Sub extends StringDecoder {}` returned the class itself from `new Sub()` instead of an instance, so `write()` was undefined.

<!-- https://github.com/oven-sh/bun/commit/fa6fed2f88d80d140245d94a58cb9cccac5aec1d -->

- Fixed: `process.exit()` called a replaced `process.reallyExit` with the wrong `this` (now `process`). It also threw a `TypeError` with an empty message when `process.reallyExit` was not a function.

<!-- https://github.com/oven-sh/bun/commit/1313ca61d4c21e9bb62e784762ffe02ca0b3b76c -->

- Fixed: seven Node.js error codes had a wrong `.message` that now matches Node.js. For example, `ERR_HTTP_TRAILER_INVALID` read `undefined` and `ERR_INVALID_URL_SCHEME` read `file`.

<!-- https://github.com/oven-sh/bun/commit/9b7c98287ff9be37f48dfecc9bbd74485cb54307 -->

- Fixed: `node-fetch`'s `fetch(url, { body })` never settled when an old-style `Stream` body that isn't a `Readable` (such as `form-data`) emitted `"error"` before `"end"`. It now rejects with that error.
- Fixed: `node-fetch`'s `new Response(stream)` threw for an old-style `Stream` that isn't a `Readable`. This broke `node-fetch-cache`.

<!-- https://github.com/oven-sh/bun/commit/a33a9c8db27c843957a50b7a754196718908ace5 -->

### Runtime

- Fixed: on Linux and macOS, after a script accessed a piped `process.stdout` or `process.stderr`, a full pipe made `console.log()` and `console.error()` silently drop the rest of their output, and made writes in `stdio: "inherit"` children fail with `EAGAIN`.
- Fixed: on Linux and macOS, an un-awaited `Bun.write(Bun.stdout, new Response(stream))` to a full pipe truncated the output and exited with code 0 when nothing else kept the event loop alive.

<!-- https://github.com/oven-sh/bun/commit/ba3f27d1d1ce359d4eed842c135f0f6fba1acb00 -->

- Fixed: on Linux and macOS, a read from `process.stdin` or a child process's `stdout` that failed right after returning data (for example `ECONNRESET`) could end the stream with `'end'` instead of `'error'`.

<!-- https://github.com/oven-sh/bun/commit/dc3660dea66f61b1b99975f78af3d9848b3a7797 -->

- Fixed: a promise that `fetch()`, `Bun.write()`, `server.fetch()` or `Bun.resolve()` returned already rejected (for example `fetch("http://[bad")`) never emitted `unhandledRejection` when nothing awaited or caught it, so the process exited 0.

<!-- https://github.com/oven-sh/bun/commit/85c9f6e60da1283ccf4447ed0407cfa1639a7019 -->

- Fixed: promise callbacks queued from a `beforeExit` listener (for example the code after an `await`) never ran before `exit`. This needed a script that had not yet used `process.nextTick` or loaded `node:stream`.

<!-- https://github.com/oven-sh/bun/commit/b5e2208974c526d17bb56d7675adbd85cb028923 -->

- Fixed: `drainMicrotasks()` from `bun:jsc` also ran queued I/O and `postMessage` callbacks, nesting them inside the calling callback. It now drains only microtasks and `process.nextTick`.

<!-- https://github.com/oven-sh/bun/commit/ffb316c4c43350eb5f33e406d1b1953af09abf29 -->

- Fixed: in JIT-optimized functions, a `using` dispose method that threw after the block body threw reported its own error instead of a `SuppressedError` carrying both.

<!-- https://github.com/oven-sh/bun/commit/782c4020b1d6aea588f4dffc5f9f8f12e4a2f2e1 -->

- Fixed: `error.stack` could show `Error` without the name and message, and drop `new` from constructor frames, if garbage collection ran before the stack was first read. It was reported for errors thrown by an async function and caught after `await`.

<!-- https://github.com/oven-sh/bun/commit/26e7a4b3690dce60d4dcd7f47a12b531deb00837 -->

- Fixed: calling the default `Error.prepareStackTrace` from a custom one (as source-map-support and depd do) headed every stack with `Error` instead of the error's name, like `TypeError`.
- Fixed: in non-strict CommonJS code, calling the function that `CallSite.getFunction()` gave a custom `Error.prepareStackTrace` crashed for an async function frame after `await` or a generator frame after `next()`. It now returns `undefined` for internal frames.
- Fixed: the first read of `error.stack` crashed when a custom `Error.prepareStackTrace` ran a synchronous GC (`Bun.gc(true)`, a heap snapshot) and the strict-mode function that created the error was already unreachable. Fuzzing found it, and no user reported it.

<!-- https://github.com/oven-sh/bun/commit/8dd787c64552808ab8e2f72d850be109b48d66c1 -->

- Fixed: an error message that embedded a string near the maximum string length, as in `Buffer.from("x", "q".repeat(2 ** 31 - 10))`, aborted the process. It now throws a catchable `RangeError`. `.stack` on an error with a message that long now returns `name: message` without the frames.

<!-- https://github.com/oven-sh/bun/commit/9598dcb1a0a70ffc81b4d54b748c715c21179621 -->

- Fixed: printing an error whose `code` was a `String` object with a throwing `toString` or no prototype crashed with "Bun has run out of memory".

<!-- https://github.com/oven-sh/bun/commit/051e39c262310c7e2b83d9c0a3658f81d8feb332 -->

- Fixed: a crash when remapping a stack trace if a runtime transpiler cache file had been damaged on disk (by another process or a torn write) and its sourcemap header was invalid. Bun now discards and regenerates the bad entry.

<!-- https://github.com/oven-sh/bun/commit/0131d750166c751d119ed7480235567edb22abd0 -->

- Fixed: `console.log` and `Bun.inspect` ignored the depth limit for nested `Map`, `Set`, `Array` and Error `cause` chains and printed every level. A 1000-deep `Map` printed 2 MB, and nesting thousands of levels deep threw `RangeError`.

<!-- https://github.com/oven-sh/bun/commit/e85f06be16e0e5d1b0a01d853f7e8d1633027562 -->

- Fixed: a rare crash when garbage collection ran while a module that threw during evaluation (e.g. via `import()`) or a failed `Bun.resolve()` was being rejected.

<!-- https://github.com/oven-sh/bun/commit/d27fef0b90820e68921ad39c0be20b5c5eaf4b87 -->

- Fixed: `delete require.cache[path]` of an ES module that was still loading, followed by `import()` or `require()` of it, crashed or evaluated the module twice. This needed a CommonJS dependency of that module to delete and re-import it while it loaded.

<!-- https://github.com/oven-sh/bun/commit/bc4bea921037d0a397d7ec009a608830c019bbec -->

- Fixed: `import()` crashed if `mock.module()`, a plugin's `build.module()`, or a `bun --hot` reload had replaced the module while an earlier `import()` of it was still loading dependencies.

<!-- https://github.com/oven-sh/bun/commit/7fe13e1b97531d245af56f3fa8758afa9cff1746 -->

- Fixed: a runtime plugin's `onResolve` could run up to three times for one `import` or `require()`, the extra times on its own answer. It now runs once, when that line executes.
- Fixed: `require()` of a path that a plugin's `onResolve` put in a namespace failed with `Cannot find package`. It now loads through the plugin's `onLoad`, like `import`.
- Fixed: a plugin whose `onResolve` maps `a` to `b` and `b` to `c` loaded `c` for `a`. It now loads `b`.
- Fixed: a `require()` in a branch that never ran still called a plugin's `onResolve`.
- Fixed: a plugin's `onResolve` that threw failed the whole file. It can now be caught by a `try` around the `require()`.
- Fixed: `import()` resolved a relative `path` from a plugin's `onResolve` against the working directory instead of the importing module.

<!-- https://github.com/oven-sh/bun/commit/272ff4350c5b36d10a5a3a4edb476f061d7fee9e -->

- Fixed: each garbage-collected module leaked the string that held its `import.meta` URL. Re-importing after `delete require.cache[...]`, hot reloading, or terminating Workers leaked one such string per module.

<!-- https://github.com/oven-sh/bun/commit/c9958cd84d528d354fa1d6755d1b1a9f3da28f42 -->

- Fixed: on Linux, `process.on("memoryPressure")` emitted a false `critical` event shortly after a listener was added, with no real memory pressure. Hosts running a privileged PSI watcher such as `systemd-oomd` did not see it.

<!-- https://github.com/oven-sh/bun/commit/0963a1b86b833421e3395f2881153fb951da5023 -->

- Fixed: on Linux without `pidfd_open` (an old kernel, or a seccomp filter that blocks it), a child process exiting could interrupt a system call on the main thread with `EINTR`. A native addon or `bun:ffi` call that doesn't retry could see a failed `read()`.

<!-- https://github.com/oven-sh/bun/commit/43a42a836b7a0c53fecb25aab189fba42928780a -->

- Fixed: Bun crashed at startup when the working directory, a `--config` path, or `$XDG_CONFIG_HOME`/`$HOME` was so long that adding `bunfig.toml` passed the maximum path length (4096 bytes on Linux, 1024 on macOS).

<!-- https://github.com/oven-sh/bun/commit/65245c2c3457cfc344791ed60676f7ed06bb35e1 -->

- Fixed: on macOS, `bun --watch` leaked one file descriptor for the project directory on every reload.

<!-- https://github.com/oven-sh/bun/commit/1332495a42ccdd3ddb0149d5d12c3dd48d83df12 -->

- Fixed: `bun --watch` and `bun --hot` kept a file descriptor open for every directory the resolver read, reaching thousands in `node_modules`-heavy monorepos.

<!-- https://github.com/oven-sh/bun/commit/f937cf4aaa61dc7fa6f61e00abf521f2005ccaee -->

- Fixed: after a reload followed by a garbage collection, `bun --hot` could crash, stop reloading on save, or report an already-handled rejection as the entry point's error. Which one, if any, depended on what the program allocated next.

<!-- https://github.com/oven-sh/bun/commit/4b02e1031d6195d96fc0446dfbff49297f89f2d6 -->

- Fixed: on Linux, a seccomp profile that fails `faccessat2` with `EPERM` or `EINVAL` made a hoisted `bun install` from a warm cache fail with "package was not found in the cache". Regression in Bun v1.4.0.
- Fixed: on Linux, a seccomp profile that denies `prlimit64` made `bun install`, `bun build` and `bun run <script>` panic. Regression in Bun v1.4.0.

<!-- https://github.com/oven-sh/bun/commit/96754123cfcdf0fa5a689ea977f3dae3d26c542a -->

### Transpiler

- Fixed: in a class with standard decorators, a field initializer that read a decorated field, like `@dec a = 1; b = this.a`, saw `undefined`.
- Fixed: `static { this.#m }` in a class with an `accessor` field was a `SyntaxError`.
- Fixed: two classes with standard decorators or `accessor` fields in the same scope could get each other's field initial values or throw "Cannot add the same private member more than once".
- Fixed: in `bun run`, a `static accessor` initializer that read a `let` or `const` declared above the class threw a `ReferenceError`. This needed a top-level class statement with no other side effects.

<!-- https://github.com/oven-sh/bun/commit/a22b2aa90e963de33f066bbb314221270fb5e427 -->

- Fixed: after a process transpiled about 2 GiB of modules at runtime (for example a `require.cache`-clearing loop), valid files could fail with a `SyntaxError` because keywords lost their trailing space.

<!-- https://github.com/oven-sh/bun/commit/ef6f44f37d40e1405d94362d794fe95ace86faad -->

- Fixed: the JavaScript parser crashed on an `import { ... }` clause with more than 65535 names, affecting `bun run`, `bun build`, and `Bun.Transpiler`.

<!-- https://github.com/oven-sh/bun/commit/d61e0b050f635ef6e6b1734d9f0ba554b17b7072 -->

- Fixed: `Bun.build` used quadratic memory on files that declare the same TypeScript `enum` many times. 8,192 declarations dropped from 8.6 GB to 1.1 GB.
- Fixed: a `+` chain that repeated an inlined TypeScript string `enum` member thousands of times used quadratic memory. 8,192 terms took 1.4 GB in `bun run`.
- Fixed: a TypeScript string `enum` member whose value was itself a concatenation, like `B = "1" + "2"`, printed the wrong value after it was used in a template literal. A second use crashed the transpiler.

<!-- https://github.com/oven-sh/bun/commit/3d40e50c124eff128ea41bb2a4f0ae7c91bc37b9 -->

- Fixed: a non-binding parameter in a TypeScript type literal signature, like `type T = { foo(1): void }`, reported `error: Backtrack` with no location instead of `Unexpected 1`.

<!-- https://github.com/oven-sh/bun/commit/2f9bf195710560fb38029441b1a68eac7afd0344 -->

### bun install

- Fixed: `bun install` did not apply `--cafile`, `--ca` or the bunfig `cafile`/`ca` settings when it reached an https registry through `HTTPS_PROXY`, so a registry with a self-signed certificate failed with `DEPTH_ZERO_SELF_SIGNED_CERT`. Certificates were still verified.

<!-- https://github.com/oven-sh/bun/commit/90ed91105d4e6536f65726cfc02a700b07be128e -->

- Fixed: on Windows, `bun install` hung at 100% CPU and never saved the lockfile when the package it replaced held the last hard link of a running executable, as after `--backend copyfile` or a deleted `--cache-dir`. `opencode upgrade` hit this.

<!-- https://github.com/oven-sh/bun/commit/4a658e8e4dfd0e45e6537bc47ae45324f73ab396 -->

- Fixed: `bun install` from an existing `bun.lock` into a new `node_modules` reinstalled an npm package's bundled `file:` dependency as self-referencing symlinks, so importing the package failed with `Cannot find module`. `@fly/sprites` was affected.

<!-- https://github.com/oven-sh/bun/commit/64669ab07c2e33bfa88d5a918d3e07a15021394c -->

- Fixed: a regression in Bun v1.4.0 where `bun install` rejected a root `file:` package's own relative `file:` dependencies that point outside the project.

<!-- https://github.com/oven-sh/bun/commit/b64b63069c27e4138e6104cba24e6efa893b6f06 -->

- Fixed: `bun update <name>` exited 0 and rewrote `package.json` when `<name>` was an optional dependency that resolved through an `npm:` alias and its download failed.

<!-- https://github.com/oven-sh/bun/commit/422179d2aed933c27f87c0138cfa583956086603 -->

- Fixed: `bun update <dep> <peer>` failed with `error: <dep> failed to resolve` when `<peer>` was an auto-installed peer dependency that nothing else depends on. Updating either name alone worked.

<!-- https://github.com/oven-sh/bun/commit/80de08a1db6cb7bb1ec90a4e830c1d23cbc9ea57 -->

- Fixed: `bun install` and `bun pm migrate` panicked migrating a `yarn.lock` whose `resolved` tarball URL had `/-/` right after the host, such as the tarball of the npm package named `-`.

<!-- https://github.com/oven-sh/bun/commit/643b957b42c3bbd273f578795135adedea3677f4 -->

- Fixed: `bun info` and `bun pm view` panicked when the registry returned a version entry that is not an object. They now print a parse error.

<!-- https://github.com/oven-sh/bun/commit/c462509cbda316915bf3142e1da2d96fb9461535 -->

- Fixed: `bun pm ls --all` and `bun list --all` panicked with `buffer too small` when a dependency's resolved spec, such as a tarball URL, was longer than 512 bytes.

<!-- https://github.com/oven-sh/bun/commit/2f1d7f63f1cfe0460f7c36ca55d14770ec698963 -->

- Fixed: a regression in Bun v1.4.0 where `bun pm pack` and `bun publish` panicked with `int cast` when a write to the tarball failed, for example on a full disk. They now print the error, such as `ENOSPC`, and exit 1.

<!-- https://github.com/oven-sh/bun/commit/333863f5d12efc53c5d8ca6a48f9778022c34e21 -->

### JavaScript bundler

- Fixed: a regression in 1.4.1 where a bundled `const { v } = require("./b.js")` of an ES module saw a later value of `v`. This needed the `require()` to run while `b.js` was still initializing, through an import cycle or a callback.

<!-- https://github.com/oven-sh/bun/commit/948c98b40bee15ab03ac44586e7af709486145fd -->

- Fixed: in bundled output, `Object.defineProperty`, `delete`, and `Object.freeze` on the default import of a CommonJS module did not affect later property reads (regression in 1.4.1).

<!-- https://github.com/oven-sh/bun/commit/6764ffc85951f4e080890f6ee7f4488f7dc87dab -->

- Fixed: a regression in 1.4.1 where, with `--splitting`, a lazy chunk could import an entry without `[hash]` in its name, so loading that entry with a query string (`index.js?v=1`) ran it twice.

<!-- https://github.com/oven-sh/bun/commit/37da174d500f2201793c8352f791afdd9102eab9 -->

- Fixed: with `--splitting` and `--target=bun`, a `require()` of an ES module that imports back into its caller could read a binding before it was initialized, when small chunks were merged.

<!-- https://github.com/oven-sh/bun/commit/64689a34eb84da8b2358e89e2ccde097a97de91f -->

- Fixed: with `--splitting`, a chunk shared by several entry points could print an import cycle in the wrong order, so a hoisted `var` read as `undefined` at runtime. opencode hit this when built with Bun 1.4.1 or 1.4.2.

<!-- https://github.com/oven-sh/bun/commit/97246d044e1e6e7c570ed911bb6911ec068759e5 -->

- Fixed: in `bun build` output, a barrel file's `export * as ns from "./b"` was `undefined` when a file the barrel re-exported earlier imported `ns` back from the barrel and used it at load time.

<!-- https://github.com/oven-sh/bun/commit/7a503a7899dcf12186187c38df9f3c96b3ab9ad4 -->

- Fixed: without `--splitting`, `bun build` emitted `__INVALID__REF__` for an `import()`ed module whose only top-level code, besides function declarations and constants, was a dead `await` (like `false && await 0`) or, with `--target=bun`, a `using` with a constant initializer (like `await using x = null`).

<!-- https://github.com/oven-sh/bun/commit/5f7cae40875d338d3bbd106af3197ba61fd63238 -->

- Fixed: `bun build` loaded a file's type-only and macro imports when another module imported that file with `import * as` or `export * from`. The build failed only if one of them could not be bundled, like a macro module importing `bun` under `--target=browser`.

<!-- https://github.com/oven-sh/bun/commit/de281671e7b57ad560adfb0c24a70e6aa05ba37e -->

- Fixed: tsconfig `jsxImportSource: "solid-js"` emitted `React.createElement` calls instead of using the automatic runtime. `jsx = "solid"` and `--jsx-runtime=solid` are now errors.

<!-- https://github.com/oven-sh/bun/commit/5baea6630dbde44d3ad4023d56d55e1403ffa054 -->

- Fixed: `Bun.build({ tsconfig: "./custom.json" })` ignored the option and used the `tsconfig.json` that Bun found by itself.
- Fixed: `bun build` and `bun run` printed `Internal error: directory mismatch for directory` whenever `--tsconfig-override` was passed. The override still applied and the command still succeeded.

<!-- https://github.com/oven-sh/bun/commit/bd599f5af912512b83bba0ef387d1ba3a7d5e550 -->

- Fixed: in a non-minified bundle, a binding named `NaN`, `Infinity`, or `undefined` could capture an inlined constant such as a macro returning `NaN`, changing its value.

<!-- https://github.com/oven-sh/bun/commit/e219300aa7cfcd5833208068a9810414e34d912e -->

- Fixed: after `Bun.build` finished, all but one bundler worker thread kept its memory (about 100 MB extra after bundling a 2.5 MB file) until its next task.

<!-- https://github.com/oven-sh/bun/commit/86771d09fd486a7256790d6f36602b683f7a19de -->

- Fixed: `outputs[..].bytes` from `bun build --metafile` and `Bun.build({ metafile: true })` undercounted chunks that import other outputs, have a source map comment, or are HTML.

<!-- https://github.com/oven-sh/bun/commit/3ef1657b5051918d9272a02c990bf6aeb4e7e1ef -->

- Fixed: with `--splitting`, `--metafile-md` reported an `import()` of a bundled file as an external import and counted it under "External imports".

<!-- https://github.com/oven-sh/bun/commit/e9120aabacbdd977ca37a4804b091affc4aaa592 -->

- Fixed: `Bun.build({ files })` crashed when an in-memory file contained an import or `url()` specifier longer than the OS path limit, such as an inline `data:` image over 4 KB in CSS.

<!-- https://github.com/oven-sh/bun/commit/02c1da3d126cb6399534edd826546e66b517e9f0 -->

- Fixed: `bun build` crashed on a malformed data URL with no comma, such as `url(data:)` in CSS, `href="data:"` in HTML, or `import "data:"`.

<!-- https://github.com/oven-sh/bun/commit/8d36bff512d1f8c824c74c8352240974294db48f -->

- Fixed: `bun build` with the default `--target=browser` panicked when a relative import such as `import "../.."` resolved to the filesystem root.

<!-- https://github.com/oven-sh/bun/commit/e8902eac1913fc155d8f1e3da506f97c3e736ec9 -->

- Fixed: `bun build --sourcemap` sometimes crashed when linking failed, for example on `No matching export`. It now prints the error. `Bun.build()` was not affected.

<!-- https://github.com/oven-sh/bun/commit/8f6a13a7827a2e2d604b4817731379cc64dbb215 -->

- Fixed: `Bun.Transpiler` and `bun build --no-bundle` crashed with identifier minification on an empty file or a JSON, TOML, YAML or text loader input.

<!-- https://github.com/oven-sh/bun/commit/1e60c02fe10139717cfdfd973a2a691d785268b0 -->

- Fixed: `Bun.Transpiler` and `bun build --no-bundle` printed a leading space when output began with `++x` or `+x`. They also wrapped a leading `let;` in parentheses.

<!-- https://github.com/oven-sh/bun/commit/627e407264117d2b1fcbd6eb30b1fce0b73e4730 -->

- Fixed: the dev server and `bun build --react-fast-refresh` crashed on a `.tsx` file where a class method, accessor or constructor calls anything named like a hook, such as `app.useGlobalPipes()`.
- Fixed: with React Fast Refresh, a component kept its state after an edit renamed the variables a hook is assigned to, such as `const [a, setA] = useState(0)` to `const [b, setB] = useState(0)`. The state now resets, matching `react-refresh/babel`.

<!-- https://github.com/oven-sh/bun/commit/9d9fdbe862f0853fe261d999535c9eeca1061b4b -->

- Fixed: the dev server could crash when a client sent an HMR WebSocket message that only Bun's own test suite uses. The HMR client that runs in the browser never sends it.

<!-- https://github.com/oven-sh/bun/commit/19ce83e15f1b4ffd79130a7211ca73b692361b1b -->

- Fixed: the dev server panicked on an HTML route's first bundle when two files imported a file that itself had an unresolved import, such as a package that isn't installed.

<!-- https://github.com/oven-sh/bun/commit/2e677eff1cbcf5d83d3caac30c0c55e2772c6424 -->

#### `bun build --react-compiler`

- Fixed: with `--target=browser`, the build crashed on a component where a closure read a `let` that was declared below the closure and reassigned later. With some closure bodies the component was left unmemoized instead.
- Fixed: the build crashed on a component containing an object literal with a method shorthand like `{ m() {} }`. This needed `--target=bun`, `--target=node`, or ssr output mode.
- Fixed: with `--target=browser`, the build panicked with "Expected a node for all scopes" when a ternary's test assigned a call result, like `(m = f()) ? 1 : 0`, and `m` was later put in an array or object literal. That function is now left uncompiled.

<!-- https://github.com/oven-sh/bun/commit/23a7002624f03d596af51001994e679fbb2d451f -->

- Fixed: build memory grew quadratically with the size of one component. A 100-term `||` chain used 80 MB, 400 terms about 1 GB, and 800 terms was OOM-killed at 3 GB. 800 terms now uses 78 MB.
- Fixed: build memory doubled with each statement like `if (a) { log() } else if (b) { v = 1 }` that reassigned the same local in one component. 16 of them cost 4 MB, 22 cost 1 GB, and more than 24 aborted.
- Fixed: compile time doubled with each level of function expressions nested inside one component. 20 levels took 0.18 s, 25 took 5.3 s, and 30 never finished.

<!-- https://github.com/oven-sh/bun/commit/2da1e61e28257f04afae51a2a816b9b6a103c550 -->

- Fixed: a member assignment whose right-hand side reassigns a variable used in its target, like `tail.next = tail = node` or `arr[i] = i++`, could throw a `TypeError` or store to the wrong object or index.
- Fixed: a compound assignment to a local inside a larger expression ran before that expression's earlier reads of the local, so `o["k" + i] = i += 2` wrote the wrong key. `i += 2` as its own statement was not affected.
- Fixed: two assignments of constants to the same variable inside one expression could be reordered when one value was constant-folded, so `[(x = 5), -(x = 10), x++]` returned wrong values.

<!-- https://github.com/oven-sh/bun/commit/3397d0c17a3c4111aa93434cc9ac743be716617f -->

- Fixed: a component or hook that called `require()` or `import()` inside its own body and kept the result in a local, like `const { a } = require("./x")`, threw `TypeError` or `ReferenceError` when it ran (regression in 1.4.1). A module-level `require()` was not affected.
- Fixed: without `--minify-identifiers`, a compiled component's local shadowed a bundled module's export of the same name that it read through an alias or namespace. `import { theme as defaultTheme }` then `const theme = custom ?? defaultTheme` threw `ReferenceError`.
- Fixed: assigning a value from props to a `let` variable inside a JSX prop or call argument, like `v={(x = props.n)}`, threw `ReferenceError: t0 is not defined` when the component read `x` afterwards.
- Fixed: a never-read local assigned at the end of several `catch` handlers lost its `let`, causing `ReferenceError: v is not defined`.

<!-- https://github.com/oven-sh/bun/commit/4b5862fd88a40d29b6151008a21603f1087b1c51 -->

- Fixed: with the classic JSX runtime, the output called `jsxDEV()` without importing it, so it threw `ReferenceError: jsxDEV is not defined` on first render.
- Fixed: JSX tags starting with `_` or `$` (such as the `_Trans` binding from Lingui's `<Trans>` macro) compiled to string tags, so the component never rendered.
- Fixed: a `children` attribute alongside JSX children (`<div children="x">y</div>`) was merged into an array instead of being overridden.

<!-- https://github.com/oven-sh/bun/commit/f14b7167de269f27a7c93a02d3dac102e29fd72a -->

### JavaScript minifier

- Fixed: a Bun v1.4.1 regression where `bun build --minify-syntax` (or `--minify`) output threw `ReferenceError: m is not defined`. It needed `const m = await import("./x")` inside a function, and a next statement that used `m` itself once before reading `m.n`, like `return [m, m.n]`.

<!-- https://github.com/oven-sh/bun/commit/630e921db034d177c89aa55bd74940357a7262e5 -->

- Fixed: the minifier rewrote `new Array(n, ...rest)` to `[n, ...rest]`, so an empty `rest` gave `[n]` instead of `n` empty slots (also under `bun run`).

<!-- https://github.com/oven-sh/bun/commit/8940b0eec723ac85af4810d3b066188cfe5e04a6 -->

- Fixed: with `--minify-whitespace`, a keyword directly before `require()` lost its space (`return__toCommonJS(...)`, `returnglobalThis.Bun`), so the bundle threw `ReferenceError` or failed to parse. It needed `require("bun")` with `--target=bun`, or a bundled ES module whose top level held only functions, classes and primitive constants.

<!-- https://github.com/oven-sh/bun/commit/f3842e23a3a2a1a4505a4a091b886fa8a34ca066 -->

- Fixed: with `--minify-syntax`, a computed template tag like ``ns["tag"]`x` `` on a CommonJS export lost its `this`, throwing `TypeError` when the tag used `this`.

<!-- https://github.com/oven-sh/bun/commit/a2b4233243026964922431432feaa75649caa32e -->

- Fixed: `bun build --no-bundle` and `Bun.Transpiler` with identifier minification could rename a parameter, local or import to the name of an export when that name was short (such as `t`), so the output threw `TypeError` or failed to parse. Bundled output was not affected.

<!-- https://github.com/oven-sh/bun/commit/50c68aeafe588ed23906f8c04f350e6af20e58c4 -->

### CSS Parser

- Fixed: the CSS parser rejected a `::view-transition-*` name plus classes or a chain of classes, like `::view-transition-group(hero.big)` or `::view-transition-new(.a.b)`, with `Unexpected token: .`
- Fixed: `::view-transition-group-children()` printed an "Unsupported pseudo-element" warning, and in CSS modules its name or class argument was not scoped.
- Fixed: in CSS modules, classes inside `::view-transition-group()`, `::view-transition-old()`, `::view-transition-new()` and `::view-transition-image-pair()` were hashed but missing from the exports object.

<!-- https://github.com/oven-sh/bun/commit/08a234063c6fe452afec47bd664b0603810d004d -->

- Fixed: `bun build` dropped an explicit `border-box` clip from the CSS `background` shorthand when the origin was `content-box`, turning `red content-box border-box` into `red content-box`.

<!-- https://github.com/oven-sh/bun/commit/812799ce8c3db80d55727cf8e0d5ae8bcb6bf5da -->

- Fixed: `bun build` could drop a CSS rule that had nested rules. This needed the same selector four times in one file: two plain rules that merged into the rule before them, the rule with nesting, then a plain rule repeating its properties.

<!-- https://github.com/oven-sh/bun/commit/6212450fc0e4946f6d1649eecbf37487c022c15d -->

### bun test

- Fixed: `mock.module()` spun at 100% CPU forever when its factory returned a pending promise for a module that was already imported, as in the vitest partial-mock pattern.

<!-- https://github.com/oven-sh/bun/commit/09bb5463058074ef143a9d9a5a405d669c787375 -->

- Fixed: with `jest.useFakeTimers()`, `advanceTimersByTime()` and `runOnlyPendingTimers()` never returned when an `abort` listener armed a new `AbortSignal.timeout(0)` every time it fired, or when code polled with `while (!done) await Bun.sleep(0)`.

<!-- https://github.com/oven-sh/bun/commit/368a6f728d3c790637ed510a9518350dc6cda0b6 -->

- Fixed: with `bun test --isolate` or `--parallel`, a promise or callback that a finished test file left in flight could run during the next file and leak its timers, servers, or `process.chdir()` into it.
- Fixed: with `bun test --isolate`, a `FinalizationRegistry` callback from a finished file could run during a later file if a garbage collection landed just as the first file ended. If that callback threw, the later file lost its remaining tests.
- Fixed: with `bun test --isolate` or `--parallel`, a static `import` that a runtime plugin's `onResolve` put in a `namespace` never reached the plugin's `onLoad`. This happened when the resolved path alone no longer matched the `onResolve` filter, as with `./data.bar?custom` or `virt:thing`.
- Fixed: `bun test --parallel` exited 130 on SIGTERM instead of 143, and a worker that crashed mid-file left processes its test spawned running after the run.

<!-- https://github.com/oven-sh/bun/commit/afd78836a70587427ffdb773d6f4d23d611652a1 -->

- Fixed: a crash when a `node:vm` context, or a finished test file's global under `bun test --isolate` or `--parallel`, was garbage collected while one of its `FinalizationRegistry` callbacks was still queued.
- Fixed: a crash in `bun test --isolate` and `--parallel` when a finished test file left a `Bun.SQL` or `Bun.RedisClient` open and retried from its rejected query or `onclose` handler, once the retry's `connectionTimeout` fired.

<!-- https://github.com/oven-sh/bun/commit/f4d755a9cf5fc732511bdab354a103b4a7833356 -->

- Fixed: `bun test` could crash with `NAPI FATAL ERROR` after all tests passed when a native addon such as `sqlite3` still had work in flight.

<!-- https://github.com/oven-sh/bun/commit/90fba662a360559ff57a2448e2255a8ee8097499 -->

- Fixed: `bun test --coverage` counted only the last load of a file loaded more than once, such as `import("./lib.ts?a")` then `?b`, so lines only an earlier load ran showed as uncovered. Two overlapping `import()`s of one file dropped it from the report.

<!-- https://github.com/oven-sh/bun/commit/e13ec92794dd17b9c96ef9b39517e9f258b90ca0 -->

- Fixed: `spyOn(obj, 0)` on a non-function indexed property returned the mock on reads instead of the value and crashed on the next write.

<!-- https://github.com/oven-sh/bun/commit/a65a98f83ab8c78a27bdd59726413ec9b133673e -->

- Fixed: in `bun test`, an assertion that compared an asymmetric matcher like `expect.any(String)` or `expect.stringContaining()` with an array hole crashed instead of failing. Inside `expect.arrayContaining()`, so did a matcher at an index past the end of the actual array.
- Fixed: `expect.not.any()`, `expect.resolvesTo.any()` and `expect.rejectsTo.any()` gave the wrong verdict for primitive values, so `expect(5).toEqual(expect.not.any(Number))` passed.
- Fixed: in `bun test`, a snapshot matcher or a failing `toEqual()` crashed when it had to print a value nested many thousands of levels deep. It now throws a `RangeError`.

<!-- https://github.com/oven-sh/bun/commit/e196cd6abba60ae2c3c42eb29ffa6fdc82e37a8a -->

### SQL / SQLite / S3 clients

- Fixed: in `Bun.SQL` (Postgres), binding a `number[]`, a plain object or a `Date` to a `bytea` parameter silently stored an empty `bytea`. Strings, Buffers and TypedArrays were stored correctly. It now rejects with a `TypeError`.
- Fixed: in `Bun.SQL` (Postgres), a parameter that threw while it was encoded, such as an object whose `toString()` throws or `{ a: 1n }` bound to `jsonb`, closed the connection, failing its pipelined queries and open transaction. Now only that query rejects.
- Fixed: in `Bun.SQL` (Postgres), a result value the client could not decode, such as a multidimensional array, closed the connection and rejected every other pipelined query on it. Now only that query rejects.

<!-- https://github.com/oven-sh/bun/commit/73df7bb270965923541cb9081836b225e761a4f2 -->

- Fixed: in `Bun.SQL` with MySQL, a query that failed client-side (e.g. a bad parameter) while it waited in a connection's queue never settled, and the next query queued on that connection resolved with another query's rows.

<!-- https://github.com/oven-sh/bun/commit/c86bd187369d3c43d284430795267830efda73af -->

- Fixed: in `Bun.SQL` (Postgres), right after a pipelined query failed, a statement new to that connection and the query issued with it could resolve with each other's rows. This depended on timing, except behind pgdog, where a syntax error triggered it every time.
- Fixed: in `Bun.SQL` (Postgres), `sql.begin()` resolved even though the server rolled the transaction back, when the callback swallowed a failed query's error. It now rejects with `ERR_POSTGRES_COMMIT_ROLLED_BACK`.
- Fixed: in `Bun.SQL` (MariaDB), a `JSON` column holding text that MariaDB accepts but `JSON.parse` refuses closed the connection and rejected every queued query. Now only the query that read it rejects.

<!-- https://github.com/oven-sh/bun/commit/951a8b593af7d01d97ba838ba88e7ce2882e6bdb -->

- Fixed: `Bun.SQL` (Postgres) returned a zero from a `numeric(p, s)` column as `"0"` instead of `"0.0000"` when the query used the binary protocol (prepared statements).

<!-- https://github.com/oven-sh/bun/commit/b786d9b9946d0e812081814f8960f5b30a2d73ac -->

- Fixed: `bun:sqlite` statements with more than 65535 parameters threw a wrong "expected N values" error, which broke large `Bun.SQL` sqlite bulk inserts (one report: 7389 rows of 11 columns). With an object of named parameters, the extra ones were silently bound as `NULL`.
- Fixed: `bun:sqlite` bound a TypedArray with a detached ArrayBuffer as `NULL` instead of an empty BLOB.
- Fixed: `bun:sqlite` bound a 2 GiB `Uint8Array` as empty text instead of throwing `SQLITE_TOOBIG`.
- Fixed: `Database.deserialize()` in `bun:sqlite` threw for an `ArrayBuffer`, which its types and docs accept.

<!-- https://github.com/oven-sh/bun/commit/f0331c3e88cb896768eef6a9fca5ba04a350761e -->

- Fixed: `Database.setCustomSQLite()` threw `SQLite already loaded` in a Worker when called with the same path the process had already loaded.

<!-- https://github.com/oven-sh/bun/commit/c9bdae4b7a77f22801f542400be109c0fffcf858 -->

- Fixed: `Bun.write(s3file, Bun.file(path))` and `s3file.writer()` held the entire payload in memory during a multipart upload, so a 500 MB upload raised peak RSS by about 850 MB.
- Fixed: an `S3File.writer()` garbage-collected without `end()` leaked its buffered bytes, left the multipart upload open, and kept the process from exiting.

<!-- https://github.com/oven-sh/bun/commit/a5e0d87e991a2f900bb0dff15c6d68beb9e5a110 -->

### TypeScript types

- Fixed: the `TextEncoder.encodeInto()` types marked both arguments optional, so calls missing an argument type-checked but threw at runtime.

<!-- https://github.com/oven-sh/bun/commit/6c45f50f83005010e51870a918df1cf0f99bdf46 -->

- Fixed: `@types/bun` rejected code that runs fine, including `test.todo("label")` with no callback, `test("label", { retry: 1 }, fn)`, ``expect(await sql`select 1`).toEqual(rows)``, `Bun.YAML.parse(buffer)`, and `new Blob().slice()` without `lib.dom`.
- Fixed: `@types/bun` failed to type check in projects installed with `linker = "isolated"` and `globalStore = true`. `tsc` reported `TS2307: Cannot find module 'undici-types'` when `skipLibCheck` was off.

<!-- https://github.com/oven-sh/bun/commit/e655c5803297cc44bb96d844d7766815af0220ad -->
