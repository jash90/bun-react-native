---
source: https://bun.com/blog/bun-v1.4.2 (markdown: https://bun.com/blog/bun-v1.4.2.md)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504 (docs repo HEAD at fetch time; blog posts are not in oven-sh/bun, fetched from bun.com)
---

# Bun v1.4.2

> This release fixes two regressions impacting Elysia and AsyncLocalStorage, a hang in @discordjs/ws, CMYK JPEG decoding in Bun.Image, a rare JIT crash, and a GC crash on musl.

_Full post saved verbatim._


This release fixes two regressions impacting Elysia and `AsyncLocalStorage`, a hang in `@discordjs/ws`, CMYK JPEG decoding in `Bun.Image`, a rare JIT crash, and a GC crash on musl.

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

## Fixed: `bun build` variable name collision

A regression introduced in Bun v1.4.1 impacting Elysia caused `bun build` to rename a nested `var` to the same name as a `let` in the same block. Builds importing Elysia would fail to load with `SyntaxError: Cannot declare a var variable that shadows a let/const/class variable`. This has been fixed and a regression test has been added.

```js#index.js
function foo () {
  {
    let exports2 = {};
    var exports = exports2;
  }
  return exports;
}
module.exports = foo();
```

`bun build index.js --outfile out.js` would output code containing:

```js#out.js
// inside CJS module wrapper
function foo() {
  {
    let exports2 = {};
    var exports2 = exports2; // SyntaxError
  }
  return exports2;
}
module.exports = foo();
```

The same bug could also give a `let` the name of a function parameter or `catch` binding, producing code that evaluates but computes incorrect values.

<!-- https://github.com/oven-sh/bun/commit/9eb082ab7fc6addd4307f7ab8c6d4cdff112b745 -->

## Fixed: `AsyncLocalStorage` memory leak

A regression introduced in Bun v1.4.1 caused a timer, immediate, or pending promise created inside `store.exit()` or a nested `store.run()` to keep the outer store value alive for as long as that timer or promise existed. `getStore()` still returned the correct value, so only memory usage was affected. This has been fixed.

```ts
const store = new AsyncLocalStorage();

store.run(bigPerRequestContext, () => {
  store.exit(() => setTimeout(() => {}, 3_600_000));
  // kept bigPerRequestContext alive for an hour
});
```

<!-- https://github.com/oven-sh/bun/commit/74326db585fe67c2a02bef1119c9e54ab05addf9 -->

## Fixed: `worker_threads` `'online'` event order

A `Worker` from `node:worker_threads` didn't emit `'online'` first, causing `@discordjs/ws` to hang due to missing a worker's first message. The order now matches Node.js.

```ts
import { Worker, isMainThread, parentPort } from "worker_threads";
import { once } from "events";

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  await once(worker, "online");
  worker.on("message", (msg) => {
    console.log(msg); // never received in v1.4.1
  });
} else {
  parentPort.postMessage("hi");
}
```

<!-- https://github.com/oven-sh/bun/commit/9fdcf5af20726a8416349c2afb3d366908d6fd77 -->

## Fixed: `Bun.Image` decodes CMYK and YCCK JPEGs

`Bun.Image` now decodes 4-component CMYK and YCCK JPEGs. Previously these failed with `Image: decode failed`. They are converted to RGB on decode, so every transform and output format works.

```ts
await new Bun.Image("photo-cmyk.jpg").resize(400, 400).webp().bytes();
```

<!-- https://github.com/oven-sh/bun/commit/7b0b70ece52704561a8f9ee36a2b6f10cd588acf -->

## Upgraded JavaScriptCore

Bun v1.4.2 pulls in about 350 more upstream WebKit commits. They include `Intl` and TypedArray correctness fixes, a fix for a `Proxy` crash, and cheaper `Date` objects.

```ts
new Intl.PluralRules("en").select(1n); // => "one" (was TypeError)
```

- `new Int32Array(array)` (and the other TypedArray constructors) read a stale or missing element when an element's `valueOf` mutated `array` during conversion.
- `TypedArray.prototype.slice` into a `Symbol.species` view that overlaps its source on the same buffer now copies in spec order.
- `Intl.DurationFormat` with `style: "digital"` no longer prints a stray `:` when `minutes` is `0` and hidden.
- `Object.setPrototypeOf(handler, null)` on a `Proxy` handler that had already served a trap could crash when the handler came from a class defined inside a function called many times.

<!-- https://github.com/oven-sh/bun/commit/d296efbb4e5bfcd45cd0e93da312c793a1f5b701 -->

## Bugfixes

- Fixed: a rare crash in long-running processes after a prototype that JIT-optimized code had cached property lookups through was garbage-collected.

<!-- https://github.com/oven-sh/bun/commit/9584239284e187ef8a79bc7cc5456c1921e3c7d2 -->

- Fixed: on musl (Alpine), `Array.prototype.splice`, `shift`, or shrinking `array.length` on an array of objects could crash on a GC thread or hang if it ran while the GC was marking.

<!-- https://github.com/oven-sh/bun/commit/7e3744509ce9417b209b45d93419cebdc1123755 -->

- Fixed: `.json()` on a `Response`, `Blob`, `Bun.file()`, or `proc.stdout` rejected invalid JSON with a generic `Failed to parse JSON` instead of the `SyntaxError` message `JSON.parse` gives, such as `JSON Parse error: Expected '}'`.

<!-- https://github.com/oven-sh/bun/commit/5fb9ecbf844650e55b7453162956a17db4b653e6 -->

- Fixed: `bun install` and `bun add` could panic with `range end index out of range` when `bun.lockb` or a cached registry manifest stored a package-name hash that didn't match the name.

<!-- https://github.com/oven-sh/bun/commit/86b2e060cff00c02743aa61126a19bc811991d21 -->

- Fixed: on Linux, if registering a `Bun.file().writer()` `FileSink` with epoll failed (for example `fs.epoll.max_user_watches` exhausted), its file descriptor was closed twice, which could close an unrelated descriptor that reused the number.

<!-- https://github.com/oven-sh/bun/commit/3044dc6834e5449d20317ad7c41f04013d32e5b0 -->

### Thanks to 3 contributors!

- [@dylan-conway](https://github.com/dylan-conway)
- [@jarred-sumner](https://github.com/jarred-sumner)
- [@robobun](https://github.com/robobun)
