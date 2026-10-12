---
source: https://bun.com/blog/bun-v1.4 (markdown: https://bun.com/blog/bun-v1.4.md)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504 (docs repo HEAD at fetch time; blog posts are not in oven-sh/bun, fetched from bun.com)
---

# Bun 1.4

> Bun 1.4 rewrites Bun in Rust, ships built-in headless browser automation (Bun.WebView), Bun.Image, Bun.markdown, JSON5, JSONL, Terminal and cron APIs, Node.js 26.3.0 compatibility with 1,517 newly passing tests, parallel test and run, Windows ARM64, and an opt-in global virtual store for up to 7× faster installs.

_Excerpt: kept whole sections on Node.js compatibility, bun install, bun test, upgrading/breaking changes, developer experience/processes, plus any subsection mentioning install/linker/lockfile/trustedDependencies/node_modules/workers/fs.watch/argv/preload/bunfig/BUN_OPTIONS/child_process/jest/mocks. Full verbatim post: see blog-full/ in this directory._


> Bun is the complete toolkit for building and testing full-stack JavaScript and TypeScript applications. If you're new to Bun, you can learn more from the [Bun 1.0](/blog/bun-v1.0) blog post.

{% raw %}

<iframe width="560" height="315" src="https://www.youtube.com/embed/i38DgEuaJwM" title="Bun 1.4" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

{% /raw %}

{% codetabs %}

```sh#curl
curl -fsSL https://bun.sh/install | bash
```

```powershell#powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

```sh#npm
npm install -g bun
```

```sh#brew
brew install oven-sh/bun/bun
```

```sh#docker
docker pull oven/bun
```

{% /codetabs %}

Bun 1.4 adds +1,517 tests from the Node.js test suite - our biggest jump in Node.js compatibility since Bun 1.0. Bun v1.4 also fixes over 2,900 issues. It reduces idle CPU usage by 5x, reduces memory usage by up to 35%, and starts 50% faster on Linux. It adds [`Bun.Image`](#bun-image), [`Bun.WebView`](#bun-webview), [`Bun.markdown`](#bun-markdown), [`Bun.cron()`](#bun-cron), [`Bun.Terminal`](#bun-terminal), [`bun run --parallel`](#bun-run-parallel), [`bun test --parallel`](#bun-test-parallel), [`bun audit fix`](#bun-audit-fix), [`bun dedupe`](#bun-dedupe), and [`bun prune`](#bun-prune). And it rewrites Bun from Zig to Rust.

This post covers everything we've shipped since Bun 1.3.0 (with new to Bun v1.4 tagged).

To upgrade:

```sh
bun upgrade
```

## Node.js compatibility

Bun is designed to be a drop-in replacement for Node.js. We've added +1,517 tests from the Node.js test suite to run on every commit of Bun.

{% image src="/images/blog/bun-1.4/node-test-suite-progress.png" alt="Chart of Node.js test suite files passing in Bun, from 1,450 at v1.2.0 to 3,743 in v1.4.0" /%}

`node:http`, `node:fs`, `node:cluster`, `node:timers`, `node:zlib`, `node:vm`, and `node:stream` pass 97% of Node's own tests; `node:quic` 99%; `node:events`, `node:trace_events`, and `node:sqlite` 100%.

{% nodeCompatBoard /%}

Bun is not 100% compatible with Node.js yet. In practice, much of the existing JavaScript ecosystem just works. You can more closely [track Bun's Node.js test suite progress here](https://bun.com/node-test-suite).

### Playwright {% since "1.4.0" /%}

Playwright now runs on Bun: drive a browser with `connectOverCDP()`, run your suite with `playwright test` and a `playwright.config.ts`, open `--ui`, and launch Chromium on Windows.

### Next.js 16 {% since "1.3.2" /%}

`bun --bun next build` works on Next.js 16.3 with Turbopack and the React Compiler.

### vitest {% since "1.4.0" /%}

vitest runs under Bun, including `--coverage`, with the threads and forks pools.

### OpenTelemetry {% since "1.4.0" /%}

OpenTelemetry's http and fs instrumentation export spans, and `shimmer` and `require-in-the-middle` patch bundled code.

### dd-trace {% since "1.4.0" /%}

`dd-trace` traces and `@datadog/pprof` profiles continuously; the V8 C++ APIs they link against are implemented.

### Additional Node.js compatibility improvements

Every day, Bun gets closer to 100% Node.js compatibility. More packages now work in Bun without changes:

- **Nuxt**: `nuxt dev` connects HMR and the Nuxt DevTools.
- **testcontainers** and **dockerode**: `container.exec()` works.
- **https-proxy-agent** and **socks-proxy-agent**: `http.request()` tunnels through them.
- **crawlee**: crawls through `proxy-chain`.
- **@grpc/grpc-js** and **ConnectRPC**: servers behind Envoy and clients behind AWS ALB work.
- **amqplib**: connects to RabbitMQ.
- **@aws-sdk/client-s3**: streaming uploads work.
- **TypeORM**: starts with the decorator settings in your `tsconfig.json`.
- **nock**: intercepts `http` and `https` requests.
- **Fastify `inject()`** and **light-my-request**: work.
- **happy-dom**: no longer breaks `console.log`.
- **piscina**: runs.

New Node.js APIs in Bun:

- **`worker_threads`**: `resourceLimits`, `stdout`, `stderr`, and `eval` options.
- **ws**: `'upgrade'` and `'unexpected-response'` events.
- **`socket.upgradeTLS({ isServer: true })`**: server-side STARTTLS.
- **`node:cluster`**: shares listening sockets between workers.
- **`node:repl`**, **`node:trace_events`**, **`node:domain`**: implemented.

## Production

_(parent section; only matching subsections kept)_

### Backpressure

`Bun.serve` automatically pauses the `ReadableStream` request & response bodies when the connection can't accept more data, so a slow or stalled client holds at most one buffer's worth of server memory.

```ts
Bun.serve({
  routes: {
    "/": () => {
      return new Response(
        new ReadableStream({
          // pauses when the socket's send buffer fills
          pull(controller) {
            controller.enqueue(new Uint8Array(65536));
          },
        }),
      );
    },
  },
});
```

`fetch()` does the same on the receiving side. This also works with `TransformStream` like `CompressionStream` & `DecompressionStream`, and `HTMLRewriter.transform`, `child_process`, `Bun.spawn`, `Bun.file(path).stream()`, `Blob.stream()` and more.

{% backpressureTank /%}

## What's new

_(parent section; only matching subsections kept)_

### `Bun.WebView` {% since "1.3.12" improved="1.4.0" /%}

[`Bun.WebView`](/docs/runtime/webview) is headless browser automation built into Bun, without Puppeteer or Playwright.

```ts
await using view = new Bun.WebView({ width: 800, height: 600 });
await view.navigate("https://bun.sh");
await view.click("a[href='/docs']");
const title = await view.evaluate("document.title");
await Bun.write("page.png", await view.screenshot());
```

Navigate, click, scroll, run JavaScript, and take screenshots. Clicks and scrolls are real user input.

On macOS it uses the system WebKit, with nothing to install. On macOS, Linux, and Windows it can also drive an installed Chrome, Chromium, or Edge. [#39423](https://github.com/oven-sh/bun/pull/39423)

`Bun.WebView` extends `EventTarget`, returns `Blob` screenshots, and exposes a `.cdp(method, params?)` escape hatch for raw Chrome DevTools Protocol commands. See the [docs](/docs/runtime/webview) for advanced usage.

{% webViewFilmstrip /%}

### `Bun.markdown` {% since "1.3.8" improved="1.4.0" /%}

[`Bun.markdown`](/docs/runtime/markdown) is a Markdown parser built into Bun.

```ts
const html = Bun.markdown.html("# Hello **world**");
// "<h1>Hello <strong>world</strong></h1>\n"

// ANSI terminal output
const ansi = Bun.markdown.render("# Hello\n\n**bold**", {
  heading: (children) => `\x1b[1;4m${children}\x1b[0m\n`,
  paragraph: (children) => children + "\n",
  strong: (children) => `\x1b[1m${children}\x1b[22m`,
});

// React
export default function Page() {
  return Bun.markdown.react(readme);
}
```

`Bun.markdown.html()` gives you an HTML string. `Bun.markdown.react()` gives you React elements, and you can swap in your own component for any tag. `Bun.markdown.render()` gives you a callback per element, for things like terminal output.

GFM tables, strikethrough, task lists, and autolinks are supported, `.md` is a bundler loader, and the parser runs in linear time on adversarial input.

The HTML output is not sanitized: raw HTML, event-handler attributes, and `javascript:` hrefs pass through verbatim.

### `Bun.cron()` {% since "1.3.11" improved="1.4.0" /%}

[`Bun.cron()`](/docs/runtime/cron) registers a scheduled job with the operating system: crontab on Linux, launchd on macOS, Task Scheduler on Windows.

Your script exports a `scheduled(controller)` handler, the same shape as Cloudflare Workers Cron Triggers.

Standard 5-field cron syntax works, including named days and `@daily`. [#26999](https://github.com/oven-sh/bun/pull/26999)

```ts
// Register an OS-level cron job
await Bun.cron("./worker.ts", "30 2 * * MON", "weekly-report");

// Parse a cron expression → next matching UTC Date
const next = Bun.cron.parse("*/15 * * * *");

// worker.ts
export default {
  async scheduled(controller) {
    // controller.cron === "30 2 * * 1"
    // controller.scheduledTime === 1737340200000
    await doWork();
  },
};
```

You can also pass a function instead of a file. Bun runs it on the event loop, with no system cron involved.

Jobs never overlap, and `using` stops the job when it goes out of scope.

```ts
using job = Bun.cron("*/5 * * * *", async () => {
  await cleanupTempFiles();
});
job.cron; // "*/5 * * * *"
job.unref(); // allow process exit
job.stop(); // cancel (or let `using` dispose)
```

`Bun.cron` schedules run in local time by default, with a new `{ tz }` option for explicit timezones; `parse()` rejects `from` timestamps outside the ECMAScript `Date` range. [#35122](https://github.com/oven-sh/bun/pull/35122) [#29282](https://github.com/oven-sh/bun/pull/29282)

### Dev tooling {% since "1.3.2" improved="1.4.0" /%}

- **`--cpu-prof`, `--cpu-prof-md`**: A `.cpuprofile` for Chrome DevTools, or the same profile as a Markdown report for pasting into a bug or an LLM; `BUN_CPU_PROFILE=1` for processes you can't pass flags to. [#24112](https://github.com/oven-sh/bun/pull/24112) [#26327](https://github.com/oven-sh/bun/pull/26327)
- **`--heap-prof`, `--heap-prof-md`**: A V8-compatible `.heapsnapshot`, or a Markdown report of the biggest types and objects. [#26326](https://github.com/oven-sh/bun/pull/26326)
- **Async stack traces**: Errors from async native APIs (`fs.promises`, `Bun.file()`, S3, DNS, crypto, `fetch`) point back to the `await` in your code. [#28652](https://github.com/oven-sh/bun/pull/28652)
- **`--no-orphans`**: Bun exits when its parent dies and SIGKILLs every descendant on exit, on Linux, macOS, and Windows. [#29930](https://github.com/oven-sh/bun/pull/29930)
- **`--no-env-file`**: Skip automatic `.env` loading in production and CI (`env = false` in `bunfig.toml`). [#24767](https://github.com/oven-sh/bun/pull/24767)

### HTML routes sourcemaps disabled in production {% since "1.4.0" /%}

In production, `Bun.serve` no longer serves sourcemaps for HTML routes, so your original source stays on your server.

Development mode still serves them. Set `sourcemap` under `[serve.static]` in `bunfig.toml` to pick explicitly. [#36982](https://github.com/oven-sh/bun/pull/36982)

```toml
[serve.static]
sourcemap = "linked"
```

## `bun install`

`bun install` is an npm-compatible package manager.

On a T3-stack Next.js app, `bun install` is many times faster than yarn, pnpm, and npm, and uses a fraction of the memory.

That holds for a first install, a fresh checkout, CI with and without a cache, and a no-op reinstall:

{% installMatrix /%}

### Global virtual store: up to 7x faster installs {% since "1.3.14" improved="1.4.0" /%}

`bun install --linker=isolated` now uses a shared global virtual store. Packages are extracted once into Bun's cache and symlinked into each project's `node_modules/.bun/` store, instead of being copied into `node_modules` on every install. [#29489](https://github.com/oven-sh/bun/pull/29489)

On a warm isolated install, copying packages into `node_modules` (`clonefileat()` on macOS) was 95% of main-thread time, and macOS runs only one of those calls at a time.

Once a package exists anywhere on the machine, later installs do one `symlink()` per package instead of one `clonefileat()`.

On the common CI path (lockfile present, cache warm, `node_modules` wiped), a 1,400-package install is **7x faster**. The global store is opt-in: it applies when you select the isolated linker, which is not the default for existing projects.

```toml
# bunfig.toml
[install]
linker = "isolated"
```

### `bun pm diff` {% since "1.4.0" /%}

[`bun pm diff`](/docs/pm/cli/pm#diff) shows you what changed between two versions of a package.

It starts with a summary: which files changed, any new install scripts, and any new imports of `child_process`, `fs`, `net`, or `vm`. Then it shows the diff.

Minified files are un-minified before diffing, and formatting-only changes are skipped, so you see the lines that actually changed. [#39229](https://github.com/oven-sh/bun/pull/39229)

```sh
$ bun pm diff react                     # the version in bun.lock → latest
$ bun pm diff react@18.2.0 19.0.0       # two published versions
$ bun pm diff ./vendored-pkg pkg@2.1.0  # a folder against a published version
$ bun pm diff react-dom@18.2.0 18.3.1 '*.min.js'
```

### `bun audit fix` {% since "1.4.0" /%}

[`bun audit fix`](/docs/pm/cli/audit#bun-audit-fix) upgrades vulnerable packages to a safe version and installs.

If a fix needs a new major version, it tells you, and `--latest` lets it do that. `--dry-run` shows what it would change. [#38333](https://github.com/oven-sh/bun/pull/38333)

```sh
$ bun audit fix
fixing:
  ms@0.7.0 → 0.7.1
  lodash@4.17.20 → 4.17.21
    package.json: 4.17.20 → 4.17.21

blocked by a dependent's range:
  minimatch@0.3.0 → 3.0.2
    express@3.21.2 depends on minimatch@0.3.0

Fixed 2 vulnerabilities in 2 packages
1 vulnerability remaining
```

{% lazyVideo src="/images/blog/bun-1.4/tweets/bun-audit-fix.mp4" poster="/images/blog/bun-1.4/tweets/bun-audit-fix-poster.jpg" width=1200 height=1200 label="bun audit fix updating vulnerable dependencies" /%}

### `bun dedupe` {% since "1.4.0" /%}

[`bun dedupe`](/docs/pm/cli/dedupe) removes duplicate versions of packages from `bun.lock`.

If you have `esbuild@0.15.10` and `esbuild@0.15.11` and one version satisfies both, you end up with one. It never changes `package.json`, and `--check` fails CI if there are duplicates. [#38333](https://github.com/oven-sh/bun/pull/38333)

```sh
$ bun dedupe
bun dedupe v1.4.0 (abc12345)

↳ esbuild 0.15.10 → 0.15.11
↳ react 18.2.0 → 18.3.1

2 duplicate versions removed, 3 packages installed (checked 5 packages) [12.00ms]
```

{% lazyVideo src="/images/blog/bun-1.4/tweets/bun-dedupe.mp4" poster="/images/blog/bun-1.4/tweets/bun-dedupe-poster.jpg" width=1200 height=1200 label="bun dedupe deduplicating semver-compatible resolved package versions" /%}

### `bun prune` {% since "1.4.0" /%}

[`bun prune`](/docs/pm/cli/prune) deletes packages from `node_modules` that aren't in `bun.lock` anymore.

`bun prune --production` also deletes `devDependencies`, so you can build with them and ship without them. [#38333](https://github.com/oven-sh/bun/pull/38333)

```sh
$ bun prune --production
bun prune v1.4.0 (abc12345)

- typescript@5.4.0
- @types/node@20.11.5
2 packages removed (checked 948) [22.00ms]
```

```dockerfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
RUN bun prune --production
```

{% lazyVideo src="/images/blog/bun-1.4/tweets/bun-prune.mp4" poster="/images/blog/bun-1.4/tweets/bun-prune-poster.jpg" width=1600 height=900 label="bun prune cleaning unnecessary folders from node_modules" /%}

### `bun pm licenses` {% since "1.4.0" /%}

`bun pm licenses` lists your dependencies by license.

`--json` gives you machine-readable output, and `--prod` skips `devDependencies`. [#38333](https://github.com/oven-sh/bun/pull/38333)

```sh
$ bun pm licenses --prod --json > licenses.json
```

### `bun update` updates transitive dependencies {% since "1.4.0" /%}

`bun update` now updates the dependencies of your dependencies too, not just the ones in your `package.json`.

```sh
$ bun update
$ bun update zod
$ bun update '@types/*' --latest
```

`bun update <name>` updates that package everywhere it appears, and `bun update '@types/*'` takes a pattern. [#38333](https://github.com/oven-sh/bun/pull/38333)

### `bun add --filter` {% since "1.4.0" /%}

`bun add`, `bun remove`, and `bun update` accept `--filter`, so you can add a package to one workspace from the root of your monorepo.

```sh
$ bun add zod --filter api
$ bun run --filter 'web...' build
```

`--filter 'web...'` means `web` and everything it depends on. `--filter '...web'` means everything that depends on `web`.

### `bun add --catalog` {% since "1.4.0" /%}

`bun add <pkg> --catalog` adds the package to your root catalog and writes `"catalog:"` in the workspace's `package.json`.

```sh
$ bun add react --catalog
```

If the package is already in your default catalog, plain `bun add` uses it.

### Nested overrides {% since "1.4.0" /%}

You can now override a dependency's dependency without overriding it everywhere. npm's nested form, yarn's `a/b`, and pnpm's `a>b` all work, and an override can be scoped to a version range.

```json
{
  "overrides": {
    "express": { "qs": "6.13.0" },
    "lodash@<4.17.21": "4.17.21"
  }
}
```

### Lockfile integrity for GitHub and tarball dependencies {% since "1.3.10" /%}

`bun.lock` now records a SHA-512 hash for GitHub and tarball dependencies, the same way it always has for npm packages. Existing lockfiles pick up the hashes on the next install.

```json-diff
- ["pkg@github:user/repo#ref", {}, "resolved-commit"]
+ ["pkg@github:user/repo#ref", {}, "resolved-commit", "sha512-..."]
```

### `trustedDependencies` only auto-trusts the npm registry {% since "1.3.5" /%}

Bun's default trusted-dependencies list applies only to packages from the npm registry.

A `file:`, `link:`, `git:`, or `github:` dependency named esbuild gets no trust from the real esbuild's entry. To run its lifecycle scripts, list it in `trustedDependencies` yourself.

```json-diff
  {
    "dependencies": {
      "esbuild": "github:some-fork/esbuild#main"
    },
+   "trustedDependencies": ["esbuild"]
  }
```

Trusted-dependency names, `.npmrc` scope names, and local `file:` paths are compared by their full bytes rather than a hash, and registry credentials stay scoped to their configured host — never sent cross-origin, downgraded to `http://`, or printed in error or verbose output.

### `nativeDependencies` and `ignoreScripts` {% since "1.3.2" /%}

For packages that ship prebuilt binaries as per-platform `optionalDependencies` (esbuild and @esbuild/darwin-arm64), Bun links the right binary directly instead of running `postinstall`. List them in `nativeDependencies`.

`ignoreScripts` skips a package's lifecycle scripts entirely, even if it is also in [`trustedDependencies`](/docs/pm/lifecycle#trusteddependencies). [#24283](https://github.com/oven-sh/bun/pull/24283)

Configure both in `package.json`, or disable native binary linking with [`BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER=1`](/docs/pm/cli/install) and script skipping with `BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS=1`.

```json
{
  "nativeDependencies": ["esbuild", "my-custom-package"],
  "ignoreScripts": ["sharp", "another-package"]
}
```

## `bun test`

`bun test --parallel` runs test files across worker processes. `--shard` splits them across CI machines. `--timings` balances both by how long each file takes. `--changed` runs only the tests your diff touches.

```sh
$ bun test --changed=main                                  # only what your branch touches
$ bun test --parallel --timings=timings.json --update-timings
$ bun test --parallel --shard=1/3 --timings=timings.json   # in CI, per machine
```

### `bun test --parallel` {% since "1.3.13" improved="1.4.0" /%}

`bun test --parallel[=N]` runs test files across N worker processes (defaulting to your CPU count). Files go to whichever worker frees up next. [#29354](https://github.com/oven-sh/bun/pull/29354)

```sh
$ bun test --parallel
$ bun test --parallel=4 --isolate
```

Coverage and JUnit output are merged across workers. `--bail` stops every worker on the first failure.

`--parallel` implies `--isolate` (below). `--no-isolate` turns that off, so each worker keeps one global and one module registry for every file it runs.

Each worker exposes its 1-indexed slot as `JEST_WORKER_ID` / `BUN_TEST_WORKER_ID`, so Jest setups that key databases or ports off `JEST_WORKER_ID` work unchanged. Preload scripts with top-level `await` complete before any worker starts running tests.

{% testParallelLanes /%}

### `bun test --isolate` {% since "1.3.13" improved="1.4.0" /%}

`bun test --isolate` runs each test file in a fresh JavaScript global object, in the same process. This is how Jest and Vitest behave by default. It makes "passes alone, fails in the full suite" bugs go away. [#29354](https://github.com/oven-sh/bun/pull/29354)

```sh
$ bun test --isolate
```

Between files, Bun:

- creates a new `globalThis`, so properties a file put on `globalThis`, patched built-ins, and module-level state are gone
- clears the ESM and CommonJS module registries, so every file re-evaluates its imports
- closes servers, sockets, file watchers, and subprocesses the file left open, cancels its timers, and restores fake timers
- re-runs `--preload` scripts in the new global

Transpiled source and bytecode are cached at the process level and shared across globals. The second file to import a module skips reading, transpiling, and parsing it. Only the module's top-level code runs again.

Bun 1.4 fixes several stability problems from the first release of `--isolate`:

- Fake timers a file left installed no longer leak into the next file. [#36385](https://github.com/oven-sh/bun/pull/36385)
- Subprocesses started at module scope are killed when the file ends, instead of outliving the run. [#38750](https://github.com/oven-sh/bun/pull/38750)
- `process.chdir()` in one file no longer changes the working directory of the next file. [#36175](https://github.com/oven-sh/bun/pull/36175)
- Servers, sockets, and other handles a file leaked no longer pin its global object in memory. [#31793](https://github.com/oven-sh/bun/pull/31793)
- A `--preload` script with top-level `await` finishes before the first test runs. [#30888](https://github.com/oven-sh/bun/pull/30888)
- Native addons (N-API) work across files, instead of pointing at the previous file's global. [#30216](https://github.com/oven-sh/bun/pull/30216)
- Fixed a crash when garbage collection ran during the swap between two files. [#29573](https://github.com/oven-sh/bun/pull/29573)
- The debugger resolves breakpoints in files loaded under `--isolate`. [#37352](https://github.com/oven-sh/bun/pull/37352)

### `bun test --shard` {% since "1.3.13" improved="1.4.0" /%}

`bun test --shard=M/N` splits your test files across multiple CI runners. Files are sorted deterministically and distributed round-robin so every machine sees the same partition, with 1-based indexing matching Jest, Vitest, and Playwright. Works alongside `--changed` and `--randomize`. An empty shard exits 0 instead of failing. [#29366](https://github.com/oven-sh/bun/pull/29366)

```sh
# In a matrix of 3 jobs:
$ bun test --shard=1/3
$ bun test --shard=2/3
$ bun test --shard=3/3
```

### `bun test --timings` {% since "1.4.0" /%}

`--timings=<path>` reads per-file durations from a previous run so `--shard` and `--parallel` balance by wall time instead of file count. `--update-timings` records the durations. [#36814](https://github.com/oven-sh/bun/pull/36814)

```sh
$ bun test --timings=timings.json --update-timings   # record per-file durations
$ bun test --shard=1/3 --timings=timings.json        # cut shards by equal time
$ bun test --parallel --timings=timings.json         # workers start slowest first
```

With timings, each shard gets about the same total time instead of the same number of files. Files that share imports stay together, so the module cache stays warm.

`--parallel` starts each worker on its slowest file first. The timings file is written slowest-first, so it doubles as a slow-test report.

{% image src="/images/blog/bun-1.4/tweets/test-timings.jpg" width="3200" height="1800" alt="bun test --timings and --parallel --shard using longest-processing-time-first scheduling" caption="`bun test --timings` records how long each test file takes; `bun test --parallel --shard=i/N` uses timings to split CI shards via longest-processing-time-first scheduling, making large test suites run faster" /%}

### `bun test --changed` {% since "1.3.13" improved="1.4.0" /%}

`bun test --changed` runs only the test files affected by your uncommitted changes, or by the diff against a branch or commit with `--changed=main`. The flag is vitest-compatible. [#29262](https://github.com/oven-sh/bun/pull/29262)

```sh
$ bun test --changed           # uncommitted (unstaged + staged + untracked)
$ bun test --changed=HEAD~1    # diff against a commit / branch / tag
$ bun test --changed=main
$ bun test --changed --watch   # re-filters on every restart
```

Bun scans every test file's imports, asks git which files changed, and walks the import graph backwards to find the tests that reach them.

tsconfig `paths` aliases like `@/*` work. With `--watch`, editing any source file re-filters on restart.

{% changedGraph /%}

### `bun test --retry` {% since "1.3.3" improved="1.4.0" /%}

`test()` accepts `{ retry: n }` to re-run a flaky test up to `n` times, and `{ repeats: n }` to run it `n` times and fail if any run fails.

`bun test --retry <N>` sets a default for the whole suite. [#23713](https://github.com/oven-sh/bun/pull/23713) [#26866](https://github.com/oven-sh/bun/pull/26866)

```ts
test(
  "flaky network call",
  async () => {
    await fetch("https://example.com");
  },
  { retry: 5 },
);

test(
  "stress",
  () => {
    if (Math.random() < 0.1) throw new Error("uh oh!");
  },
  { repeats: 20 },
);
```

### `jest.useFakeTimers()` {% since "1.3.4" improved="1.4.0" /%}

`jest.useFakeTimers()` lets you control `setTimeout`, `setInterval`, and `Date` from your tests.

`@testing-library/react`'s `waitFor` detects the fake timers and advances them instead of waiting in real time. [#23764](https://github.com/oven-sh/bun/pull/23764) [#25915](https://github.com/oven-sh/bun/pull/25915)

```ts
import { jest, test, expect } from "bun:test";

test("debounce", () => {
  jest.useFakeTimers();
  let called = 0;
  setTimeout(() => called++, 1000);
  jest.advanceTimersByTime(1000);
  expect(called).toBe(1);
  jest.useRealTimers();
});
```

`jest.setSystemTime()` works with `advanceTimersByTime()`, and `Bun.cron` schedules can be driven by the fake clock. [#33623](https://github.com/oven-sh/bun/pull/33623)

## `bun build`

_(parent section; only matching subsections kept)_

### In-memory files in `Bun.build()` {% since "1.3.6" /%}

`Bun.build()` accepts a `files` option: a map of paths to strings, `Blob`s, or `TypedArray`s. Use it to bundle entirely from memory or mix virtual modules with real files on disk — virtual paths take precedence. Handy for codegen, or for stubbing a module in tests without touching disk. [#25852](https://github.com/oven-sh/bun/pull/25852)

```ts
await Bun.build({
  entrypoints: ["/app/index.ts"],
  files: {
    "/app/index.ts": `import { greet } from "./greet.ts"; console.log(greet("World"));`,
    "/app/greet.ts": `export function greet(name: string) { return "Hello, " + name + "!"; }`,
  },
});
```

### `metafile: true` {% since "1.3.6" improved="1.4.0" /%}

`Bun.build()` supports `metafile: true`, returning build metadata in esbuild's metafile format: a full map of inputs, outputs, imports, exports, and byte sizes. `result.metafile` works as-is with https://esbuild.github.io/analyze/ and anything else that reads esbuild's format. [#25842](https://github.com/oven-sh/bun/pull/25842)

```ts
const result = await Bun.build({
  entrypoints: ["./index.js"],
  metafile: true,
});

console.log(result.metafile.inputs);
console.log(result.metafile.outputs);
```

## Platforms

_(parent section; only matching subsections kept)_

### Bun runs inside an AppContainer {% since "1.4.0" /%}

Bun runs inside a Windows [AppContainer](https://learn.microsoft.com/windows/win32/secauthz/appcontainer-isolation), so embedders can sandbox it with a lowbox token.

`bun install`, `bun run`, `Bun.spawn`, `child_process.fork`, and `Bun.Terminal` all work inside the container.

Bun also now works on read-only directories like Program Files and read-only network shares, and no longer fails when an ancestor directory isn't readable.

## Upgrading to 1.4

Most code is unaffected. Five changes are the most likely to need a line in your project:

- **Node.js 26**: `process.versions.modules` is now `147`. Packages that pick a prebuilt native addon by `NODE_MODULE_VERSION` need a build for `147`. `res.writeHeader()` is gone; use `res.writeHead()`. Paused-mode `readable.read()` returns one chunk. [#31991](https://github.com/oven-sh/bun/pull/31991)
- **New monorepos default to the isolated linker**. `bun.lock` records `configVersion: 1`. Existing lockfiles keep the hoisted linker. To opt out, pin `linker = "hoisted"` in `bunfig.toml`. [#24236](https://github.com/oven-sh/bun/pull/24236)
- **Bun invoked as `node`** (`bun --bun`, `bunx --bun`, a `node` symlink) does not load `.env` files. This matches Node. Pass `--env-file` to keep them. [#36610](https://github.com/oven-sh/bun/pull/36610)
- **`Bun.YAML` follows YAML 1.2**: `yes`/`no`/`on`/`off` are strings. `on:` in a GitHub Actions workflow parses as `"on"`. [#25537](https://github.com/oven-sh/bun/pull/25537)
- **`Bun.TOML` and `bunfig.toml` are strict**: unquoted strings, missing newlines between pairs, and integers past `Number.MAX_SAFE_INTEGER` are `SyntaxError`s. [#32953](https://github.com/oven-sh/bun/pull/32953)

{% details summary="Every behavior change in 1.4" %}

### Node.js 26: `NODE_MODULE_VERSION` `147`, `res.writeHeader()` removed, paused `read()` returns one chunk {% since "1.4.0" /%}

Bun now reports [Node.js 26](#node-js-26). Three things change:

- `process.versions.modules` is `147`. Packages that pick a prebuilt native addon by `NODE_MODULE_VERSION` need a build for `147`.
- `res.writeHeader()` in `node:http` is removed. Call `res.writeHead()`.
- In paused mode, `readable.read()` with no size returns one buffered chunk. Before, it returned the whole buffer. (`setEncoding()` keeps the old behavior.) Loop until it returns `null`.

[#31991](https://github.com/oven-sh/bun/pull/31991)

```js-diff
- res.writeHeader(200, { "Content-Type": "text/plain" });
+ res.writeHead(200, { "Content-Type": "text/plain" });
```

### x64 builds are now baseline-only {% since "1.4.0" /%}

x64 releases now ship only the baseline build. The separate build compiled with `-march=haswell` is gone. The `-baseline` download URLs and npm packages still exist and contain the same binary. Existing install scripts and `bun upgrade` keep working. The `CPU lacks AVX support` startup warning is removed. [#34782](https://github.com/oven-sh/bun/pull/34782)

### `Temporal` is now defined by default, and `toEqual()` compares Temporal objects by value {% since "1.4.0" /%}

`Temporal` and `Date.prototype.toTemporalInstant` are now defined. Set `BUN_JSC_useTemporal=0` to turn them off. `Bun.deepEquals()`, `toEqual()`, `toStrictEqual()`, and `util.isDeepStrictEqual()` now compare Temporal objects by value. Before, any two instances of the same class were equal. [#32978](https://github.com/oven-sh/bun/pull/32978) [#37024](https://github.com/oven-sh/bun/pull/37024)

```js
Bun.deepEquals(
  Temporal.PlainDate.from("2020-01-01"),
  Temporal.PlainDate.from("1999-12-31"),
); // false
```

### `bun:ffi`: `cstring` values are plain strings and `CString` no longer has `.ptr` {% since "1.4.0" /%}

`bun:ffi` is now [engine-native](#bun-ffi-is-engine-native-and-3-faster). This changes four things:

- A `returns: "cstring"` value or a `cstring` callback argument is a plain string. A `NULL` pointer is `null`.
- `new CString(ptr)` returns a string with no `.ptr`, `.byteLength`, or `.arrayBuffer`. Keep the original pointer if you need to free it.
- `napi_env` and `napi_value` argument types throw `TypeError` outside `cc()`.
- `dlopen()` and the other entry points throw `TypeError` when the JIT is disabled.

[#35246](https://github.com/oven-sh/bun/pull/35246)

```js-diff
  const str = new CString(ptr);
- my_library_free(str.ptr);
+ my_library_free(ptr);
```

### `bun build --compile` no longer auto-loads `tsconfig.json` or `package.json` at runtime {% since "1.3.4" /%}

Standalone executables built with `bun build --compile` no longer auto-load `tsconfig.json` or `package.json` from the runtime working directory. Before, a compiled binary could pick up unrelated config files from the directory it ran in. To opt back in, pass `--compile-autoload-tsconfig` / `--compile-autoload-package-json` (or `compile.autoloadTsconfig` / `compile.autoloadPackageJson` in `Bun.build()`). `.env` and `bunfig.toml` still auto-load by default. They keep their existing `--compile-autoload-dotenv` / `--compile-autoload-bunfig` flags. [#25340](https://github.com/oven-sh/bun/pull/25340)

### `bun install` defaults to the isolated linker for new monorepos {% since "1.3.2" /%}

New monorepos (projects with workspaces) now use `linker: "isolated"`. This is a symlinked `node_modules` layout that prevents phantom dependencies. `bun.lock` records a `configVersion`. Existing lockfiles (config version 0) keep the hoisted linker they were created with. Your `node_modules` layout does not change on upgrade. [#24236](https://github.com/oven-sh/bun/pull/24236)

```toml-diff
  # bunfig.toml: pin the old behavior if you need it
  [install]
+ linker = "hoisted"
```

### `bun.lock` is now `lockfileVersion: 2` {% since "1.4.0" /%}

New lockfiles use version 2. Version 2 adds two stricter parse-time checks:

- npm packages resolved to a tarball outside your configured registry must carry an integrity hash.
- git dependency entries are validated to block path traversal (no `/`, `\`, or `..`).

Lockfiles written as v0/v1 keep loading without these checks. Existing projects do not break. Run `bun install` to migrate.

```json-diff
  {
-   "lockfileVersion": 1,
+   "lockfileVersion": 2,
    "workspaces": { ... },
```

### Bun invoked as `node` no longer loads `.env` files {% since "1.4.0" /%}

When Bun runs as `node` (under `bun --bun`, `bunx --bun`, or a `node` symlink to Bun), it no longer loads `.env`, `.env.local`, or `.env.{development,production,test}`. This matches Node.js. `bun file.js` still loads them. A `package.json` script that calls `node` under `bun --bun run` now sees those variables as `undefined`. To keep them, pass `--env-file` to `node`. [#36610](https://github.com/oven-sh/bun/pull/36610)

```json-diff
  "scripts": {
-   "check": "node ./check.js"
+   "check": "node --env-file=.env ./check.js"
```

### `Bun.YAML` now parses `yes`/`no`/`on`/`off` as strings, not booleans {% since "1.3.5" /%}

`Bun.YAML` now parses booleans per the YAML 1.2 spec. `yes`/`no`/`on`/`off`/`y`/`Y` are plain strings, not booleans. These are YAML 1.1 legacy values that the 1.2 spec dropped. An `on:` key in a GitHub Actions workflow file now parses as the string `"on"`, not `true`. Only `true`/`True`/`TRUE` and `false`/`False`/`FALSE` resolve to booleans. [#25537](https://github.com/oven-sh/bun/pull/25537)

```js
Bun.YAML.parse("on: push");
// { on: "push" }
```

### `Bun.TOML.parse()` and `bunfig.toml` are stricter and throw `SyntaxError` {% since "1.4.0" /%}

The rewritten [`Bun.TOML`](#bun-toml) parser throws `SyntaxError` instead of `BuildMessage`. It rejects TOML that the old parser let through:

- unquoted string values
- missing newlines between key/value pairs
- integers outside `Number.MAX_SAFE_INTEGER`

A `bunfig.toml` with an unquoted value now fails at startup with `TOML Parse error: Strings must be quoted`. Quote the value. [#32953](https://github.com/oven-sh/bun/pull/32953)

```toml-diff
  [install]
- linker = isolated
+ linker = "isolated"
```

### `.xml` imports now return the parsed document instead of the file path {% since "1.4.0" /%}

`import` or `require()` of a `.xml` file now returns the same object as [`Bun.XML.parse()`](#bun-xml). This applies at runtime and in `bun build`. Before, it returned the file's path. A file that does not parse throws at runtime and fails the build. To keep getting the path, pass `--loader .xml:file`. [#37048](https://github.com/oven-sh/bun/pull/37048)

### `import "."` and `import ".."` now resolve as directories {% since "1.4.0" /%}

`"."` and `".."` in `import` and `require()` now resolve to the directory's index file or `package.json` `main`. This matches Node.js. Before, they resolved to a sibling file with the directory's name. So `"."` inside `lib/run.ts` loaded `lib.ts`; it now loads `lib/index.ts`. To keep the sibling, name it. [#36969](https://github.com/oven-sh/bun/pull/36969)

```js-diff
- import { e } from ".";
+ import { e } from "../lib";
```

### `.css` imports at runtime now export `{}` instead of the file path {% since "1.4.0" /%}

At runtime, the default export of a `.css` import is now `{}`. This applies to `import`, `require()`, dynamic `import()`, and Workers. Before, it was the file's absolute path as a string. `bun build` already emitted `{}`. `.module.css` still differs from `bun build`, which emits a class-name map. [#35163](https://github.com/oven-sh/bun/pull/35163)

### `"jsx": "react-jsx"` in `tsconfig.json` now emits `jsx` instead of `jsxDEV` {% since "1.4.0" /%}

With `"jsx": "react-jsx"`, `bun run` and `bun build` now import `jsx` and `jsxs` from `<pkg>/jsx-runtime`. Before, both imported `jsxDEV` from `<pkg>/jsx-dev-runtime` unless `NODE_ENV=production` or `--production` was set. An explicit `NODE_ENV` still wins. To keep the development runtime, set `"jsx": "react-jsxdev"`. [#34422](https://github.com/oven-sh/bun/pull/34422)

```json-diff
  {
    "compilerOptions": {
-     "jsx": "react-jsx"
+     "jsx": "react-jsxdev"
    }
  }
```

### `useDefineForClassFields: false` in `tsconfig.json` is now honored {% since "1.4.0" /%}

With `useDefineForClassFields: false`, Bun now does what tsc does:

- Instance field initializers move into the constructor, after parameter-property assignments.
- Plain declaration-only fields are dropped.

Before, the option was ignored. An initializer that reads a parameter property now works instead of throwing. Private and decorated fields keep their declarations. Static fields and classes with a computed non-literal field key are left as they were. To keep the old output, remove the option. [#36664](https://github.com/oven-sh/bun/pull/36664)

### `Bun.Socket#setKeepAlive()` now treats `initialDelay` as milliseconds {% since "1.4.0" /%}

`setKeepAlive(true, delay)` on a `Bun.Socket` now divides `delay` by 1000 before setting `TCP_KEEPIDLE`, as documented. Before, the raw value was used as seconds, so `4000` meant 4000 seconds. A value under 1000 now divides to `0` and leaves `TCP_KEEPIDLE` unchanged. Code that passed seconds should pass milliseconds. `setKeepAlive(true)` now returns `true` instead of `false`. `net.Socket#setKeepAlive()` still sets the same kernel value as before. [#34269](https://github.com/oven-sh/bun/pull/34269)

```js-diff
- socket.setKeepAlive(true, 60);
+ socket.setKeepAlive(true, 60_000);
```

### `Bun.mmap({ offset })` now starts the view at `offset` {% since "1.4.0" /%}

`Bun.mmap(path, { offset })` now returns a view whose index 0 is the byte at `offset`. Before, `offset` was rounded down to a page boundary. The view started at that boundary, for reads and for writes through `{ shared: true }`. Remove any `offset % pageSize` adjustment you added to compensate. [#34120](https://github.com/oven-sh/bun/pull/34120)

```js-diff
  const m = Bun.mmap("data.bin", { offset: 100 });
- m[0]; // byte 0 of the file
+ m[0]; // byte 100 of the file
```

### `Bun.cron.parse()` and in-process `Bun.cron()` now use local time {% since "1.4.0" /%}

[`Bun.cron.parse()`](#bun-cron) and the in-process `Bun.cron(schedule, handler)` overload now read schedules in the process's local time zone. Before, they used UTC. This matches the OS-registered overload. `"0 9 * * *"` under `TZ=America/Los_Angeles` now means 9:00 Pacific. To keep the old times, pass `{ tz: "UTC" }`. Both accept it as a new final argument. [#35122](https://github.com/oven-sh/bun/pull/35122)

```js-diff
- Bun.cron("0 9 * * *", handler);
+ Bun.cron("0 9 * * *", handler, { tz: "UTC" });
```

### `Bun.$` now globs only patterns written in the template itself {% since "1.4.0" /%}

Glob characters that arrive through `${...}`, a shell variable, command substitution, or quoted text are now literal. Only `*`, `**`, and braces written directly in the template expand. `?`, `[...]`, and a leading `!` are literal everywhere. Before, `` $`echo ${"**/"}*` `` matched recursively. It now fails with `no matches found`. Write the pattern in the template instead. [#31220](https://github.com/oven-sh/bun/pull/31220)

```js-diff
- await $`echo ${"**/"}*`;
+ await $`echo **/*`;
```

### `fs.rmdir` no longer accepts `{ recursive: true }` {% since "1.4.0" /%}

Passing `recursive: true` to `fs.rmdir` now throws `ERR_INVALID_ARG_VALUE`. This matches Node.js, which removed the option after a long deprecation. Use [`fs.rm`](https://nodejs.org/api/fs.html#fspromisesrmpath-options) instead. [#31830](https://github.com/oven-sh/bun/pull/31830)

```js-diff
- await fs.rmdir("build", { recursive: true });
+ await fs.rm("build", { recursive: true, force: true });
```

### `X509Certificate` serial and modulus are now uppercase hex {% since "1.4.0" /%}

`X509Certificate#serialNumber`, `.toLegacyObject().modulus`, and `tls.TLSSocket#getPeerCertificate()` now return uppercase hex. This matches Node.js and `openssl x509 -serial`. If you pin certificates against a lowercase serial string, normalize the case first. [#31519](https://github.com/oven-sh/bun/pull/31519)

```js-diff
  const { serialNumber } = new X509Certificate(pem);
- // "3b8e2a..."
+ // "3B8E2A..."
```

### `tls.createServer({ requestCert: true })` now rejects unverified client certificates {% since "1.4.0" /%}

A `node:tls` server with `requestCert: true` and no explicit `rejectUnauthorized` now applies the default of `true`. A connection whose client certificate does not verify is destroyed, and the server emits `tlsClientError`. Before, it reached your handler with `authorized: false`. To keep admitting those clients, pass `rejectUnauthorized: false`. [#31322](https://github.com/oven-sh/bun/pull/31322)

```js-diff
  tls.createServer({
    ca,
    requestCert: true,
+   rejectUnauthorized: false,
  });
```

### `dgram.Socket` now throws synchronously on a second `bind()` and after `close()` {% since "1.4.0" /%}

Two `node:dgram` changes, both matching Node.js:

- `bind()` on a socket that is already bound throws `ERR_SOCKET_ALREADY_BOUND`. Before, it emitted an `error` event.
- `bind()`, `send()`, `address()`, `remoteAddress()`, and `close()` on a closed socket throw `ERR_SOCKET_DGRAM_NOT_RUNNING`. Before, they threw an uncoded `TypeError` (or, for `bind()`, emitted an `error` event).

Code that handled a second `bind()` in an `error` listener needs a `try`/`catch`. [#33037](https://github.com/oven-sh/bun/pull/33037) [#33024](https://github.com/oven-sh/bun/pull/33024)

### `dns.lookup()` now uses the system resolver on Linux {% since "1.4.0" /%}

On Linux, `dns.lookup()`, `dns.promises.lookup()`, and hostname resolution in `net.connect()` now go through `getaddrinfo()`, as in Node.js. Before, they used c-ares. Names that only `systemd-resolved` or a split-DNS VPN knows now resolve. Before, they failed with `getaddrinfo EREFUSED`. `dns.setServers()` no longer affects these calls. `dns.resolve*()` and `Bun.dns.lookup()` still use c-ares. If you need the old behavior for a lookup, pass `{ backend: "c-ares" }` to `Bun.dns.lookup()`. [#37383](https://github.com/oven-sh/bun/pull/37383)

### Exceptions thrown in `node:fs`, `node:dns`, and `crypto.pbkdf2` callbacks are now `uncaughtException` {% since "1.4.0" /%}

An exception thrown inside a `node:fs`, `node:dns`, or `crypto.pbkdf2()` callback now reaches `process.on("uncaughtException")`, as in Node.js. Before, it surfaced as an `unhandledRejection`. A handler registered there no longer sees it. Move the handler. [#34660](https://github.com/oven-sh/bun/pull/34660)

```js-diff
  fs.readFile("config.json", () => { throw new Error("bad config"); });
- process.on("unhandledRejection", onError);
+ process.on("uncaughtException", onError);
```

### `net.Server` and `tls.Server` no longer auto-resume accepted sockets; `tls.Server` checks `requestCert` and `rejectUnauthorized` literally {% since "1.4.0" /%}

- Sockets accepted by `net.Server` or `tls.Server` are no longer resumed automatically. Bytes that arrive before a `'data'` listener is attached are buffered, as in Node.js.
- Only a literal `rejectUnauthorized: false` disables verification. This applies to `tls.connect()` and `tls.Server`. Before, `null` did too.
- `requestCert` must be literally `true`.
- A `tls.Server` no longer reads `NODE_TLS_REJECT_UNAUTHORIZED` for its default.
- `handshakeTimeout` now also emits the socket's `'timeout'` event (after `'tlsClientError'`). It leaves the socket open instead of destroying it.
- An exception thrown in an `onread` callback or `'secureConnection'` listener is now an uncaught exception.

[#32630](https://github.com/oven-sh/bun/pull/32630) [#34598](https://github.com/oven-sh/bun/pull/34598) [#35006](https://github.com/oven-sh/bun/pull/35006)

```js-diff
  tls.createServer({
    key,
    cert,
    ca,
-   requestCert: 1,
-   rejectUnauthorized: null,
+   requestCert: true,
+   rejectUnauthorized: false,
  });
```

### `fetch()` responses and `Bun.serve` requests now combine duplicate headers with `, ` {% since "1.4.0" /%}

Duplicate headers on a `fetch()` response or a `Bun.serve` request are now joined with `, `, per the Fetch spec. Before, only the last value was kept. Common headers were already combined. This change affects the rest, including every custom header. `fetch()` responses also keep empty values now. A header sent with no value reads `""` instead of `null`. `Set-Cookie` still comes back as separate values from `getSetCookie()`. [#31734](https://github.com/oven-sh/bun/pull/31734)

```js-diff
  // X-Dup: first
  // X-Dup: second
  res.headers.get("x-dup");
- // "second"
+ // "first, second"
```

### `Request#clone()` and `Response#clone()` now throw once the body has been read {% since "1.4.0" /%}

`clone()` on a `Request` or `Response` whose body has been read, or whose stream is locked, now throws `TypeError: Body is disturbed or locked` (`ERR_BODY_ALREADY_USED`). This is per the Fetch spec. It includes the request passed to `Bun.serve` route handlers. Before, `clone()` succeeded and the problem showed up later, as an empty body or an error when the clone was read. Call `clone()` before reading the body. [#33129](https://github.com/oven-sh/bun/pull/33129)

```js-diff
- const text = await req.text();
- const copy = req.clone();
+ const copy = req.clone();
+ const text = await req.text();
```

### `fetch()` network errors are now `TypeError`, and a failed body read sets `bodyUsed` {% since "1.4.0" /%}

`fetch()` and response body reads now reject a network error with a `TypeError`. Before, it was a plain `Error`. `.code` (for example `ECONNRESET`) is still set. After a body read fails, `bodyUsed` is `true`. A second read rejects with `ERR_BODY_ALREADY_USED` instead of the socket error. Issue a new `fetch()` to retry. `fetch(request)` with a request whose stream body was already used now rejects with the same `TypeError` before connecting. [#35855](https://github.com/oven-sh/bun/pull/35855) [#36499](https://github.com/oven-sh/bun/pull/36499)

```js-diff
  const res = await fetch(url); // connection drops mid-body
- await res.text(); // rejects with Error, code "ECONNRESET"
+ await res.text(); // rejects with TypeError, code "ECONNRESET"
```

### `Bun.serve({ inspector })` has been removed {% since "1.3.14" /%}

The undocumented `inspector: true` option is now silently ignored. It mounted a `/bun:inspect` debugger WebSocket on your HTTP port. It predated `bun --inspect` and was never in the public types. Use the [`--inspect` flag](https://bun.sh/docs/runtime/debugger) to attach a debugger. [#29613](https://github.com/oven-sh/bun/pull/29613)

```js-diff
- Bun.serve({ inspector: true, fetch });
+ Bun.serve({ fetch });
```

```sh
$ bun --inspect server.ts
```

### `server.publish()` and `ws.publish()` now return `0` or `-1` under backpressure {% since "1.4.0" /%}

`server.publish()`, `ws.publish()`, `ws.publishText()`, and `ws.publishBinary()` now return:

- `0` if the message was dropped for any subscriber, or the topic had no subscribers
- `-1` if any subscriber has backpressure
- the byte count otherwise

Before, they returned the byte count whenever the topic had a subscriber, even when the data was discarded. Code that compares the return value against the byte count should treat `0` as dropped and `-1` as queued. [#32889](https://github.com/oven-sh/bun/pull/32889)

### `server.stop()` now closes idle connections and waits for in-flight requests {% since "1.4.0" /%}

`server.stop()` now closes idle keep-alive connections immediately. It closes busy ones once their response is sent. It resolves when the last connection has closed. Before, it closed only the listener and resolved while requests were still being served. It now stays pending on a connection that has sent part of a request and stopped. `server.stop(true)` closes such connections. It now works after a graceful `stop()` too. [#35130](https://github.com/oven-sh/bun/pull/35130) [#37074](https://github.com/oven-sh/bun/pull/37074)

### `WebSocket` (global) no longer accepts an `agent` option {% since "1.3.6" /%}

The non-standard `agent` option on the Web-standard `WebSocket` constructor is removed. Node.js's global `WebSocket` uses an undici `dispatcher`, not an `http.Agent`. The ws package's `WebSocket`, which Bun polyfills natively, now accepts `agent` instead. This matches its documented API. [#25935](https://github.com/oven-sh/bun/pull/25935)

```js-diff
- const ws = new WebSocket(url, { agent });          // global
+ import WebSocket from "ws";
+ const ws = new WebSocket(url, { agent });          // ws module
```

### `WebSocket#close()`, `ping()`, and `pong()` now validate their arguments {% since "1.4.0" /%}

`close()` now throws `InvalidAccessError` for a code other than `1000` to `1003`, `1007` to `1014`, or `3000` to `4999`. It throws `SyntaxError` for a reason longer than 123 UTF-8 bytes. Before, an invalid code went out unchecked. With the default code, an over-long reason was silently sent as empty. `ping()` and `pong()` on the `WebSocket` client, `ServerWebSocket`, and the ws package now throw `RangeError` for a payload over 125 bytes. Before, they sent it. Shorten the reason or payload. [#32820](https://github.com/oven-sh/bun/pull/32820) [#35030](https://github.com/oven-sh/bun/pull/35030)

### `WebSocket` now fails the handshake if a requested subprotocol is not negotiated {% since "1.4.0" /%}

`new WebSocket(url, protocols)` now closes with code `1002` when the server's `101` response omits `Sec-WebSocket-Protocol`. This is per RFC 6455 and matches browsers. Before, it opened with `ws.protocol === ""`. Fix the server to echo a protocol, or stop passing `protocols`. Connections that request no subprotocol are unaffected. [#33072](https://github.com/oven-sh/bun/pull/33072)

### `WebSocket#close()` no longer fires `close` before it returns {% since "1.4.0" /%}

`ws.close()` and `ws.terminate()` on a `WebSocket` client now queue the `close` event, as in Node.js and browsers. When the call returns, `readyState` is `CLOSING` and `onclose` has not run yet. Code that read `CLOSED` on the next line, or relied on `onclose` having run, should await the `close` event instead. [#27259](https://github.com/oven-sh/bun/pull/27259)

```js-diff
  ws.close();
- ws.readyState; // 3, CLOSED
+ ws.readyState; // 2, CLOSING
```

### `jest.resetAllMocks()` now drops mock implementations {% since "1.4.0" /%}

`jest.resetAllMocks()` and `vi.resetAllMocks()` now reset every mock's implementation as well as its call history. This matches Jest. Before, they behaved like `clearAllMocks()`. After the reset, a `jest.fn(() => 42)` returns `undefined`. A `spyOn()` spy returns `undefined` until `mockRestore()`. If you only want the call history cleared, call `clearAllMocks()`. [#33374](https://github.com/oven-sh/bun/pull/33374)

```js-diff
  afterEach(() => {
-   jest.resetAllMocks();
+   jest.clearAllMocks();
  });
```

### `expect().toContain()` now compares with `===` instead of `Object.is` {% since "1.4.0" /%}

`toContain()` in `bun:test` now compares array and iterable elements with `===` instead of `Object.is`. This matches Jest. `expect([-0]).toContain(0)` passes and `expect([NaN]).toContain(NaN)` fails. `toBe()` still uses `Object.is`. `toContainEqual()` still uses deep equality. [#32950](https://github.com/oven-sh/bun/pull/32950)

```js-diff
- expect(values).toContain(NaN);
+ expect([...values].some(Number.isNaN)).toBe(true);
```

### `Bun.sql` now decodes MySQL `DATETIME` and `TIMESTAMP` as UTC {% since "1.4.0" /%}

MySQL `DATETIME` and `TIMESTAMP` columns are now decoded as UTC. This matches how `Bun.sql` encodes them, so a `Date` round-trips unchanged. Before, it came back shifted by the machine's UTC offset on any host not running in UTC. Postgres `timestamp` read through `.simple()` is decoded as UTC too. `timestamptz` is unaffected. Remove any offset correction you added. [#31212](https://github.com/oven-sh/bun/pull/31212)

```js-diff
  await sql`INSERT INTO t (dt) VALUES (${new Date("2024-06-15T12:00:00Z")})`;
  const [{ dt }] = await sql`SELECT dt FROM t`;
- dt.toISOString(); // "2024-06-15T16:00:00.000Z" under TZ=America/New_York
+ dt.toISOString(); // "2024-06-15T12:00:00.000Z"
```

### `Bun.sql` now parses MariaDB 10.5+ `JSON` columns instead of returning strings {% since "1.4.0" /%}

On MariaDB 10.5 and later, `Bun.sql` now parses `JSON` columns and JSON function results such as `JSON_OBJECT()` and `JSON_EXTRACT()`. Before, it returned the JSON text as a string. A `json` column holding `{"b": 1}` now reads as the object `{ b: 1 }`. Remove the `JSON.parse()`. [#37130](https://github.com/oven-sh/bun/pull/37130)

```js-diff
  const [row] = await sql`SELECT a FROM t`;
- const a = JSON.parse(row.a);
+ const a = row.a; // { b: 1 }
```

### Other behavior changes {% since "1.4.0" /%}

- The `bun feedback` command is removed. [#38444](https://github.com/oven-sh/bun/pull/38444)
- `Bun.password.hash()` with argon2 now requires `memoryCost` of at least 8. Hashes made by Bun 1.3 with a lower `memoryCost` still verify. [#39596](https://github.com/oven-sh/bun/pull/39596)
- `bun update` now moves transitive packages. `bun update <name>` errors (exit 1) on a name nothing depends on. Before, it added the package. `--production`/`--prod` on `update` means "only update `dependencies` and `optionalDependencies`". `-i` updates only the selection. [#38333](https://github.com/oven-sh/bun/pull/38333)
- A project's `bunfig.toml` now overrides any `.npmrc` for the same key. [#38333](https://github.com/oven-sh/bun/pull/38333)
- `bun install <pkg> --filter x` now edits `x`, not the root. `bun add y --filter x` no longer installs a package named `x`. `add`/`remove --filter '*'` no longer includes the root. [#38333](https://github.com/oven-sh/bun/pull/38333)
- A plain `bun add x` in a workspace whose default catalog lists `x` now writes `catalog:`. `audit fix` may rewrite exact pins. `--frozen-lockfile --lockfile-only` writes nothing. Overrides/catalog changes fail frozen installs. [#38333](https://github.com/oven-sh/bun/pull/38333)
- Projects with `catalog:` peers or dead `pkg@range` override rows see one-time lockfile churn after upgrading. Lockfiles that use nested or version-scoped overrides are `lockfileVersion: 3`. Older Bun cannot read version 3. Turborepo and Nx changes to accept it are open upstream. Dependabot needs nothing. [#38333](https://github.com/oven-sh/bun/pull/38333)
- `bun init` now writes typescript `^7`. Before, it wrote `^5`, or nothing in the React templates. A fresh project installs TypeScript 7. [#33265](https://github.com/oven-sh/bun/pull/33265) [#39341](https://github.com/oven-sh/bun/pull/39341)
- `bun init` with a non-TTY stdin (CI, a piped `spawn`) now behaves as `bun init -y`. Before, it opened the template picker. [#35165](https://github.com/oven-sh/bun/pull/35165)
- `bun update -i` with a non-TTY stdin now exits with code `1` and an error. Before, it opened the picker. Use `bun update` or `bun outdated`. [#35165](https://github.com/oven-sh/bun/pull/35165)
- `bun update` with no package names now rewrites the root `catalog` and `catalogs` entries (to the newest version with `--latest`). It leaves `catalog:` references in workspace `package.json` files in place. Before, it replaced them with `^<version>`. With [`--recursive` or `--filter`](#bun-update-recursive-and-filter-update-every-selected-workspace), it rewrites each selected workspace's `package.json`. It touches the root catalog only when the root is selected. [#36304](https://github.com/oven-sh/bun/pull/36304) [#36360](https://github.com/oven-sh/bun/pull/36360) [#36379](https://github.com/oven-sh/bun/pull/36379)
- `bun install` and `bun remove` now drop a package from `bun.lock` when only an optional peer still points at it. A lockfile whose nested optional-peer placement differs from a fresh install may be rewritten once, on the first install after upgrading. [#35681](https://github.com/oven-sh/bun/pull/35681)
- [`trustedDependencies`](#trusteddependencies-only-auto-trusts-the-npm-registry) and `--trust` entries now match the exact package name. Before, they matched a truncated name hash. A package that only collides with an entry's hash no longer runs lifecycle scripts. If you meant to trust it, add the package's exact name. Entries loaded from a legacy `bun.lockb` still match by hash. [#31218](https://github.com/oven-sh/bun/pull/31218)
- `bun install --registry <url>` no longer sends the configured registry's credentials to `<url>` when it is a different host, or when it downgrades from `https://` to `http://`. [#36165](https://github.com/oven-sh/bun/pull/36165)
- `workspace:` ranges are now honored only in the root and workspace `package.json` files. Inside a downloaded package, they fail to resolve like any other unknown range. Before, they created a workspace package. [#37669](https://github.com/oven-sh/bun/pull/37669)
- `Bun.JSONC.parse()` now throws `SyntaxError` on invalid input. Before, it threw a `BuildMessage`. `Bun.JSONC.parse("")` also throws `SyntaxError`. Before, it returned `{}`. [#35066](https://github.com/oven-sh/bun/pull/35066)
- Wildcard `exports` and `imports` targets in `package.json` that do not name an existing file are now retried with each known extension, or with `.ts` in place of `.js`. A subpath such as `@modelcontextprotocol/sdk/server/stdio` now resolves. Before, it failed with `Cannot find module`. [#36299](https://github.com/oven-sh/bun/pull/36299)
- `bun build` now bundles an unresolvable `require()`, `require.resolve()`, or `await import()` inside `catch` as a runtime throw. Before, it failed with `Could not resolve`. [#35659](https://github.com/oven-sh/bun/pull/35659)
- Assigning to an imported binding is no longer a parse error at runtime. The module loads, and the assignment throws `TypeError` when reached. `bun build` still reports it as an error. [#36046](https://github.com/oven-sh/bun/pull/36046)
- `bun build --target browser` now honors a package's `browser` field entry for a Node builtin (`"crypto": false` or a remap). Before, it bundled the polyfill. It also resolves `require()` of a package that has `jsnext:main` but no `module` field to its `main`, as it already did for `module`. [#35447](https://github.com/oven-sh/bun/pull/35447) [#36597](https://github.com/oven-sh/bun/pull/36597)
- A bundled `import * as ns` namespace now enumerates its exports in sorted order. The spec requires this, and unbundled code already did it. Update snapshots that pinned the old order. [#35957](https://github.com/oven-sh/bun/pull/35957)
- `bun build --minify` no longer generates a bare `$` identifier. That identifier shadowed jQuery's `$` when a bundle was loaded as a classic script. [#35668](https://github.com/oven-sh/bun/pull/35668)
- ESM imports of builtin modules (`node:fs`, `node:process`, `node:module`), and `export * from "bun"` or a non-literal `import()` of `"bun"`, no longer evaluate every lazy export at import time. Each export is evaluated when something first binds to it. For `"bun"`, a property that throws when constructed (`Bun.redis` with an invalid `REDIS_URL`) now throws at the binding that uses it. Before, it failed the whole module. [#37525](https://github.com/oven-sh/bun/pull/37525) [#37714](https://github.com/oven-sh/bun/pull/37714) [#37726](https://github.com/oven-sh/bun/pull/37726)
- `bun build --metafile` now sets a bundled import's `path` to the imported file's `inputs` key (`src/b/shared.js`). Before, it was the raw specifier or an absolute path, so `metafile.inputs[path]` never matched. [#34534](https://github.com/oven-sh/bun/pull/34534)
- `Bun.randomUUIDv7()` now throws `RangeError` for a timestamp of `2**48` or more. Before, values up to `2**53 - 1` were truncated to 48 bits. It also throws for a `NaN` timestamp, an invalid `Date`, or a `Date` before 1970. Before, these were encoded as `0`. [#34021](https://github.com/oven-sh/bun/pull/34021)
- `Bun.udpSocket({ connect: { port } })` now throws for a port outside `1` to `65535`. Before, it connected to port `0` and dropped every datagram. [#34029](https://github.com/oven-sh/bun/pull/34029)
- `Bun.YAML.parse()` now throws `SyntaxError` on a NUL byte. Before, it silently stopped there. If you pad a buffer with zeros, pad with newlines instead.
- `Bun.color()` output changed for `"ansi-16"` (a real 16-color escape such as `\x1b[91m`), `"hsl"` and `"lab"` (valid CSS such as `hsl(0, 100%, 50%)`), and near-black `"ansi-256"` colors. A 24-bit number such as `0xff0000` is now opaque. Before, it had alpha `0`. [#33328](https://github.com/oven-sh/bun/pull/33328) [#33046](https://github.com/oven-sh/bun/pull/33046)
- `Bun.Cookie` now serializes `Expires` like `Date#toUTCString()`. Before, the weekday was one day off, the day was unpadded, and the zone was `-0000` instead of `GMT`. Update tests that assert the old string. [#32926](https://github.com/oven-sh/bun/pull/32926)
- `structuredClone()`, `self.postMessage()` inside a worker, and `new Worker(path, { transferList })` now throw `TypeError` for a transfer entry that is not an object, such as `null`. Before, they skipped it. [#32809](https://github.com/oven-sh/bun/pull/32809)
- `bun:ffi` `viewSource()` and `new JSCallback()` now throw on invalid arguments. Before, `viewSource()` returned the error, and `JSCallback` returned an instance whose `ptr` was `undefined`. [#34396](https://github.com/oven-sh/bun/pull/34396)
- `Bun.FileSystemRouter.match()` now returns `null` for a non-empty path string that does not start with `/`. Before, `"Xtop"` matched `/top`. Full URLs are unaffected. [#34028](https://github.com/oven-sh/bun/pull/34028)
- `Bun.Terminal#write()` now returns the full input length, because the whole input is buffered. Before, it returned only the bytes flushed synchronously, and re-sending the rest duplicated input. `drain` now fires on POSIX. [#34289](https://github.com/oven-sh/bun/pull/34289)
- `new Bun.RedisClient(url)` now throws `Invalid database number in Redis URL: "notadb"` when the URL path is not a database index, such as `redis://host/notadb`. Before, it connected to database `0`. [#34039](https://github.com/oven-sh/bun/pull/34039)
- `Bun.spawn()` and `Bun.spawnSync()` now throw `ERR_INVALID_ARG_VALUE` for a NUL byte in `argv0` or `cwd`. Before, `argv0` was silently cut at the NUL.
- `Bun.$` now fails with `ambiguous redirect` when a redirect target such as `> *.txt` expands to more than one word. Before, the words were joined into one path. [#34324](https://github.com/oven-sh/bun/pull/34324)
- Nine [input validation hardening](#input-validation-hardening) rounds tightened input validation and bounds checks across the runtime. Each PR lists the subsystems it touched.
- `Bun.spawn()` and `Bun.spawnSync()` now throw `ERR_OUT_OF_RANGE` for `timeout: NaN` and `ERR_UNKNOWN_SIGNAL` for `killSignal: 0`. Before, `timeout: NaN` meant no timeout, and `killSignal: 0` sent a no-op signal. The child kept running either way. [#35348](https://github.com/oven-sh/bun/pull/35348)
- `Bun.spawn()` and `Bun.spawnSync()` now throw `AbortError` (with `cause` set to `signal.reason`) for a `signal` that is already aborted. No process is created. Before, `Bun.spawn()` started the child and then killed it, and `Bun.spawnSync()` ran it to completion.
- `bun:sqlite` `db.close()` now finalizes every `db.query()` statement, not only the cached ones. `db.prepare()` statements keep working until finalized. `db.close(true)` finalizes those too. Before, it threw `database is locked`. A statement that `close()` finalized throws when used. [#36573](https://github.com/oven-sh/bun/pull/36573) [#36793](https://github.com/oven-sh/bun/pull/36793)
- `bun:sqlite` row objects and `stmt.columnNames` now keep a column aliased `AS ""`. Before, it was dropped, and a trailing one made `.all()` return a number. `columnNames` now throws after `finalize()`. [#34925](https://github.com/oven-sh/bun/pull/34925)
- Two robustness passes changed several edge cases. `Bun.spawn({ stdout: typedArray })` throws instead of aborting. `FileSystemRouter` no longer matches a URL shorter than the route pattern. CSS serialization escapes identifiers consistently. Workers read `process.env` at runtime instead of at transpile time. The PR bodies list the rest.
- `S3Client.list()` entries now expose `checksumAlgorithm`. The misspelled `checksumAlgorithme` still works but is non-enumerable. It no longer appears in `Object.keys()` or `JSON.stringify()` output. [#36502](https://github.com/oven-sh/bun/pull/36502)
- More inputs that were silently accepted now throw:

  - odd-length hex passed to `Bun.CryptoHasher#update()`
  - a primitive `options` argument to `TextDecoder#decode()`
  - invalid arguments to `crypto.createDiffieHellman()` (before, returned as an error object)
  - `NaN` or `undefined` seconds in `RedisClient#expire()` (before, sent `EXPIRE key 0`)
  - fractional or beyond-32-bit ports for `Bun.udpSocket()`, and `cost`, `timeCost`, or `memoryCost` values for `Bun.password` (before, wrapped or truncated into range)
  - `Bun.openInEditor()` with no editor found (before, returned silently)
  - an `fs.write()` `offset` past the end of the buffer when `length` is omitted (before, wrote 0 bytes)

  [#35188](https://github.com/oven-sh/bun/pull/35188) [#35189](https://github.com/oven-sh/bun/pull/35189) [#36508](https://github.com/oven-sh/bun/pull/36508) [#36835](https://github.com/oven-sh/bun/pull/36835) [#36999](https://github.com/oven-sh/bun/pull/36999) [#37210](https://github.com/oven-sh/bun/pull/37210) [#37632](https://github.com/oven-sh/bun/pull/37632)

- `new URL(bad)` now throws Node's `TypeError: Invalid URL` with `code` and `input` set. It rejects an invalid punycode `xn--` host for special schemes. [#34660](https://github.com/oven-sh/bun/pull/34660)
- `assert.deepStrictEqual()` and `util.isDeepStrictEqual()` now compare prototypes, as in Node.js. `Bun.deepEquals()` and `expect()` are unchanged. [#34660](https://github.com/oven-sh/bun/pull/34660)
- `child_process.spawn()` now ignores `options.encoding`, as Node does. `stdout` and `stderr` always emit `Buffer` chunks. Call `child.stdout.setEncoding()` to get strings. [#36050](https://github.com/oven-sh/bun/pull/36050)
- N-API status codes on validation and failure paths now match Node 26. For example, `napi_wrap()` on a non-object returns `napi_invalid_arg`. `napi_reference_ref()` returns `0` once the referent has been collected. `napi_get_buffer_info()` rejects a bare `ArrayBuffer`. Addons that branch on a specific status see Node's values. [#36805](https://github.com/oven-sh/bun/pull/36805) [#36850](https://github.com/oven-sh/bun/pull/36850)
- `fs.open()` now throws `ERR_INVALID_ARG_VALUE` when an object is passed as `flags`. Before, `{}` opened the file read-only. [#34505](https://github.com/oven-sh/bun/pull/34505)
- `fs.rm()` and `fs.rmSync()` now reject `recursive`, `force`, `retryDelay`, or `maxRetries` explicitly set to `undefined`, as Node does. Omit the key instead. [#34505](https://github.com/oven-sh/bun/pull/34505)
- On Windows, `process.binding("uv")` and every `node:fs` error now use libuv's error numbers (`-4058` for `ENOENT`). Before, the binding and some fs calls such as `fs.access()` reported CRT values like `-2`. POSIX is unchanged. [#34505](https://github.com/oven-sh/bun/pull/34505)
- `fs.write()`, `fs.writev()`, and `fs.readv()` now operate at the current file offset when `position` is not a safe integer (`NaN`, `Infinity`, a BigInt), as Node does. `fs.createWriteStream()` no longer overwrites the start of the file after a short write. [#36135](https://github.com/oven-sh/bun/pull/36135)
- `fs.appendFile()` and `fs.appendFileSync()` with `{ flag: "w" }` now truncate the file, as the flag says. Before, they appended. [#36553](https://github.com/oven-sh/bun/pull/36553)
- `fs.watch()` with `recursive: true` on Linux and FreeBSD now emits `'error'` (for example `ENOSPC`, with the subdirectory's `path`) for a subdirectory it cannot watch. It keeps watching the rest. Before, the subdirectory was skipped silently. [#36415](https://github.com/oven-sh/bun/pull/36415)
- `session.remoteSettings` in `node:http2` is now `{}` while the session is connecting or destroyed, as in Node. Before, it was `null`. Reading a setting right after `connect()` now returns `undefined` instead of throwing. `session.localSettings` is `{}` at that point too. Before the peer's ACK, it shows only the defaults plus your `customSettings`. [#34358](https://github.com/oven-sh/bun/pull/34358)
- `node:http2` `stream.end(chunk)` now sets `END_STREAM` on the `DATA` frame carrying `chunk`, as Node does. Before, it sent an empty frame after it. [#34432](https://github.com/oven-sh/bun/pull/34432)
- `node:http2` `pushStream()` now reports invalid headers only through its callback, as Node does. The pushed stream no longer also emits `'error'`. [#36551](https://github.com/oven-sh/bun/pull/36551)
- [`node:test`](#node-test) suites marked `skip` no longer run their callback. Before, the body ran and its tests were registered. `{ skip: true, todo: true }` now counts as a skip, not a todo. [#34444](https://github.com/oven-sh/bun/pull/34444)
- `process.execve()` now throws an error carrying `code`, `syscall`, `errno`, and `path` when the exec fails. This matches Node 26. Before, it printed an error and aborted.
- `process.title` now defaults to `argv[0]` as invoked. Before, it was `"bun"`. [#31831](https://github.com/oven-sh/bun/pull/31831)
- `require()`, `(await import()).default`, and `process.getBuiltinModule()` now return the same object for a natively implemented builtin such as `node:buffer`. `module.builtinModules` no longer lists `bun:wrap`. [#31831](https://github.com/oven-sh/bun/pull/31831)
- `process.reallyExit()` no longer emits `'exit'` before exiting. This matches Node. If you rely on `'exit'` listeners running, call `process.exit()`. [#34997](https://github.com/oven-sh/bun/pull/34997)
- `util.styleText()` now follows the Node 26 API. It returns plain text when the target stream (`process.stdout` by default) is not a TTY. Pass `{ validateStream: false }` to always get escape codes. `util.inspect()` now brackets `ArrayBuffer` internals (`[byteLength]: 4`). `util.format("%s", date)` prints the ISO form. `vm` module namespaces have a `null` prototype. [#34434](https://github.com/oven-sh/bun/pull/34434)
- Warnings are now printed as `(node:PID) [CODE] Name: message`. Adding a `'warning'` listener no longer replaces the default printer (see [`process`](#process)). Silence it with `process.removeAllListeners("warning")` or `--no-warnings`. [#31831](https://github.com/oven-sh/bun/pull/31831) [#37344](https://github.com/oven-sh/bun/pull/37344)
- `crypto.subtle` is now a getter on `Crypto.prototype`. It throws `ERR_INVALID_THIS` when read off anything but a `Crypto`. `subtle.importKey("jwk", ...)` with a non-JWK object now rejects with `DataError`. Before, it threw `TypeError`. An unknown key format is reported as `ERR_INVALID_ARG_VALUE`. [#34838](https://github.com/oven-sh/bun/pull/34838)
- `fetch()` now returns a rejected promise when reading its options throws. Before, it threw synchronously. A synchronous `try`/`catch` around an unawaited call no longer catches it. [#33649](https://github.com/oven-sh/bun/pull/33649)
- `Response.redirect(url)` now parses and re-serializes an absolute `url` before writing `Location`. `http://example.com` becomes `http://example.com/`. A relative `url` is written as-is. A relative `url` containing a code point above U+00FF now throws `TypeError`. [#33126](https://github.com/oven-sh/bun/pull/33126)
- `fetch()` now rejects the body read when a compressed response with neither `Content-Length` nor `Transfer-Encoding` is cut off early. Before, it resolved with partial data. [#34922](https://github.com/oven-sh/bun/pull/34922)
- `fetch()` now errors the response body when its `signal` aborts, even if the whole body has already arrived. Pending and later reads reject with `AbortError` (or the abort reason). Before, they resolved with the buffered bytes. This matches Node.js.
- `fetch()` now parses `Connection`, `Transfer-Encoding`, `Content-Encoding`, and `Upgrade` as token lists. Any `close` token disables connection reuse. `Transfer-Encoding: gzip, chunked` is framed as chunked instead of rejected. `identity` codings are ignored. A connection that carried an HTTP/1.0 response is reused only if the response said `Connection: keep-alive`. [#36777](https://github.com/oven-sh/bun/pull/36777) [#37530](https://github.com/oven-sh/bun/pull/37530)
- `fetch()` now sends Latin-1 request header values byte-for-byte, per the Fetch spec. Before, it UTF-8 encoded them. `café` goes out as `63 61 66 e9`. [#35338](https://github.com/oven-sh/bun/pull/35338)
- `fetch()` with `redirect: "error"` now rejects only on `301`, `302`, `303`, `307`, and `308`, per the Fetch spec. Other `3xx` such as `304` now resolve. Before, they rejected with `UnexpectedRedirect`. [#36539](https://github.com/oven-sh/bun/pull/36539)
- `fetch()` now treats its idle timeout (still 300 seconds by default) as one deadline for receiving the whole response header block. A server that trickles header bytes now times out. Before, each byte reset the timer. [#36145](https://github.com/oven-sh/bun/pull/36145)
- `Bun.serve({ port })` now throws a `RangeError` for non-integer, negative, or out-of-range port values. Before, it silently clamped: `port: 65536` started a server on port 65535, and `port: -1` bound a random port. Numeric strings and `null`/`undefined` still work. [#34957](https://github.com/oven-sh/bun/pull/34957)
- `Bun.serve` now treats a returned `Response` with a status outside `100` to `999`, such as `Response.error()`, like a thrown error. It goes to `error()` and answers `500` by default. Before, it wrote an invalid status line. [#33400](https://github.com/oven-sh/bun/pull/33400)
- `Bun.serve` per-method route objects (`{ GET: handler }`) now answer `HEAD` with the `GET` handler when no `HEAD` key is set. Before, the request fell through to the next route or `404`. [#32822](https://github.com/oven-sh/bun/pull/32822)
- `Bun.serve` WebSocket connections now close with code `1006` and reason `Received an incorrectly masked frame` when a client sends an unmasked frame, per RFC 6455. Before, the frame was parsed as if it were masked. [#32820](https://github.com/oven-sh/bun/pull/32820)
- `Bun.serve` now answers `413` and closes the connection when a single chunk of a chunked request carries more than 16 KiB of chunk extensions. This matches `node:http`. [#34504](https://github.com/oven-sh/bun/pull/34504)
- `Bun.serve` [HTML routes](#sourcemaps-stay-out-of-production) with `development: false` no longer emit `sourceMappingURL` or `debugId` comments. `.map` URLs answer `404`. `[serve.static] sourcemap = "linked"` in `bunfig.toml` restores them. [#36982](https://github.com/oven-sh/bun/pull/36982)
- `Bun.serve({ tls: [...] })` now enforces `requestCert` and `rejectUnauthorized` set on a per-`serverName` entry. Before, they were ignored. Clients of that name without an acceptable certificate are refused. With `http3: true`, they are enforced over QUIC too. [#36174](https://github.com/oven-sh/bun/pull/36174) [#37669](https://github.com/oven-sh/bun/pull/37669)
- `Bun.serve` now answers `400` to a request whose `Transfer-Encoding` names anything besides a single final `chunked` (`gzip, chunked`, `chunked, chunked`). Before, such requests got `200` with the body still encoded. `node:http` still accepts `gzip, chunked` but now rejects `chunked, chunked`. [#35295](https://github.com/oven-sh/bun/pull/35295)
- `server.upgrade()` now returns `false` unless the request has `Upgrade: websocket` and a well-formed `Sec-WebSocket-Key`. It answers `426` when `Sec-WebSocket-Version` is not `13`. Before, any `GET` with a 24-byte key was upgraded. [#35298](https://github.com/oven-sh/bun/pull/35298)
- `ws.subscribe()` and `ws.unsubscribe()` now return `false` on a closed `ServerWebSocket` (and are typed `boolean`). [#35236](https://github.com/oven-sh/bun/pull/35236)
- `ws.send()` and `publish()` of an in-memory `Blob` now send its bytes as a binary frame. Before, they sent the text `[object Blob]`. A `Bun.file()` blob throws; read it first. [#36032](https://github.com/oven-sh/bun/pull/36032)
- `Bun.serve` static and file routes now evaluate `If-Match` and `If-Unmodified-Since` on `GET` and `HEAD`. They answer `412` when the precondition fails. Before, both headers were ignored. [#35169](https://github.com/oven-sh/bun/pull/35169)
- `new WebSocket(url, { proxy })` now throws `SyntaxError` at construction for a proxy scheme other than `http` or `https`. Before, it failed later with `Connection ended`. [#35147](https://github.com/oven-sh/bun/pull/35147)
- `Bun.deepEquals()` now distinguishes boxed BigInts and Symbols with different contents (`Object(1n)` vs `Object(2n)`). In strict mode (`toStrictEqual()`, `assert.deepStrictEqual()`), it also distinguishes a boxed string or typed array that carries extra own properties. Before, all of these compared equal. [#34434](https://github.com/oven-sh/bun/pull/34434)
- `Bun.sql`'s `connectionTimeout` now bounds the whole handshake. Before, it restarted on every packet. A Postgres server that sends a second authentication request now fails the connection with `ERR_POSTGRES_UNEXPECTED_MESSAGE`. [#36308](https://github.com/oven-sh/bun/pull/36308)
- `Bun.sql` now honors `PGSSLMODE` from the environment. A URL `?sslmode=` still wins. `PGSSLMODE=require` against a server without TLS now fails. Before, it connected in plaintext. `?ssl=` and `?ssl-mode=` are accepted as spellings. `tls: { caFile }` enables verification like `ca`. [#36840](https://github.com/oven-sh/bun/pull/36840) [#37669](https://github.com/oven-sh/bun/pull/37669)
- `Bun.sql` now decodes a Postgres `date`, `timestamp`, or `timestamptz` of `infinity` or `-infinity` as the number `Infinity` or `-Infinity`. Before, it was an invalid `Date`. Check for it before calling `Date` methods on the value. [#35121](https://github.com/oven-sh/bun/pull/35121)
- On Linux, Bun no longer sets `prctl(PR_SET_THP_DISABLE)` at startup. That flag was inherited across `execve`. It disabled transparent huge pages in every child process spawned via `Bun.spawn`, `bun run`, or lifecycle scripts. Bun's own allocations now opt out per-mapping via `MADV_NOHUGEPAGE`. Child processes inherit the system THP setting. [#36990](https://github.com/oven-sh/bun/pull/36990)

{% /details %}

## Changelog

_(parent section; only matching subsections kept)_

### Runtime

#### `ServerWebSocket.subscriptions` {% since "1.3.2" /%}

A new `subscriptions` getter returns an array of every topic the socket is currently subscribed to. [#24299](https://github.com/oven-sh/bun/pull/24299)

#### `bun repl` {% since "1.3.10" improved="1.4.0" /%}

`bun repl` is now native. It is built directly into the Bun binary instead of lazily downloading a separate npm package on first run. It ships a full TUI:

- syntax highlighting
- the standard terminal line-editing shortcuts (Ctrl-A, Ctrl-E, Ctrl-K)
- persistent history (`~/.bun_repl_history`)
- tab completion
- multi-line input with automatic continuation detection
- the standard `.help`/`.load`/`.save`/`.editor` commands

It supports top-level `await` and the `_`/`_error` special variables. Bare object literals work too: `{ a: 1 }` no longer needs to be wrapped in parens. [#26304](https://github.com/oven-sh/bun/pull/26304)

{% bunReplDemo /%}

`bun repl` now supports `-e <script>` to evaluate and `-p <script>` to evaluate and print, with full REPL semantics. Shell completions for `repl` ship for bash, fish, and zsh, and there's a new [REPL docs page](/docs/runtime/repl). [#27436](https://github.com/oven-sh/bun/pull/27436)

```sh
$ bun repl -e 'console.log(1 + 1)'
2
$ bun repl -p '{ a: 1, b: 2 }'
{ a: 1, b: 2 }
$ bun repl -p 'await fetch("https://bun.sh").then(r => r.status)'
200
```

#### `bun ./README.md` {% since "1.3.12" /%}

Bun pretty-prints Markdown files directly to your terminal: headings, tables, task lists, blockquotes, syntax-highlighted code blocks, and clickable hyperlinks, with correct alignment for emoji and Chinese/Japanese/Korean characters. No JavaScript VM is started. [#28833](https://github.com/oven-sh/bun/pull/28833)

```sh
$ bun ./README.md
```

{% bunReadmeDemo /%}

#### `Bun.JSON5` {% since "1.3.7" improved="1.4.0" /%}

Bun ships a native JSON5 parser. [`Bun.JSON5.parse()`](/docs/runtime/json5) and `Bun.JSON5.stringify()` are built in, and `.json5` files can be imported directly in both the runtime and the bundler with no npm package needed. It passes the official JSON5 test suite. [#26439](https://github.com/oven-sh/bun/pull/26439)

```ts
import config from "./config.json5";

const data = Bun.JSON5.parse(`{
  // comments work
  unquoted: 'single quotes',
  trailing: [1, 2, 3,],
}`);
```

#### `Bun.JSONL` {% since "1.3.7" /%}

[`Bun.JSONL`](/docs/runtime/jsonl) is a built-in newline-delimited JSON parser. It is implemented in C++ on top of JavaScriptCore's optimized JSON parser. `Bun.JSONL.parse()` parses a complete JSONL string or `Uint8Array` into an array. `Bun.JSONL.parseChunk()` parses as many complete values as possible from streaming input. It returns `{ values, read, done, error }`, so you can resume where you left off without losing partial results. It parses ASCII input without an extra copy, skips UTF-8 BOMs automatically, and guards against inputs larger than 4 GB. [#26356](https://github.com/oven-sh/bun/pull/26356)

```ts
const results = Bun.JSONL.parse('{"a":1}\n{"b":2}\n');
// [{ a: 1 }, { b: 2 }]

const chunk = Bun.JSONL.parseChunk('{"id":1}\n{"id":2}\n{"id":3');
chunk.values; // [{ id: 1 }, { id: 2 }]
chunk.read; // 17
chunk.done; // false
```

#### `Bun.JSONC.parse()` {% since "1.3.6" improved="1.4.0" /%}

[`Bun.JSONC.parse()`](/docs/runtime/file-types) parses JSON with `//` and `/* */` comments and trailing commas. It's the same parser Bun uses internally to read `tsconfig.json`, exposed as a runtime API alongside `Bun.YAML` and `Bun.TOML`. [#22115](https://github.com/oven-sh/bun/pull/22115)

```ts
const config = Bun.JSONC.parse(`{
  // This is a comment
  "name": "my-app",
  "dependencies": {
    "react": "^18.0.0", // trailing comma allowed
  },
}`);
```

#### `Bun.XML` {% since "1.4.0" /%}

[`Bun.XML`](/docs/runtime/xml) is a native XML parser. `Bun.XML.parse()` and `Bun.XML.stringify()` are built in, and `.xml` files can be imported directly in both the runtime and the bundler, alongside `Bun.TOML`, `Bun.YAML`, and `Bun.JSON5`. Parsing is ~5× faster than `fast-xml-parser` and `xml2js` on ~200 KB feeds. [#37048](https://github.com/oven-sh/bun/pull/37048)

```ts
import feed from "./atom.xml";

Bun.XML.parse(`<order id="A1"><item>Tea</item><item>Mug</item><paid/></order>`);
// { order: { "@id": "A1", item: ["Tea", "Mug"], paid: "" } }

Bun.XML.parse(`<p>Hi <b>you</b></p>`, { compact: false });
// { name: "p", attributes: {}, children: ["Hi ", { name: "b", ... }] }
```

#### `Bun.TOML` {% since "1.4.0" /%}

[`Bun.TOML`](/docs/runtime/toml) was rewritten for full [TOML v1.1.0](https://toml.io/) conformance and now passes 708/708 cases in the official [toml-test](https://github.com/toml-lang/toml-test) suite.

```ts
const cfg = Bun.TOML.parse(`
released = 2026-08-10T12:00:00Z

[package]
name = "app"
`);
cfg.released; // "2026-08-10T12:00:00Z"

Bun.TOML.stringify({ name: "app", deps: { bun: "1.4.0" } });
// name = "app"
//
// [deps]
// bun = "1.4.0"
```

#### `Bun.Archive` {% since "1.3.6" /%}

[`Bun.Archive`](/docs/runtime/archive) is a new built-in for creating and extracting tarballs without `node-tar` or any other dependency.

```ts
const archive = Bun.Archive.from({
  "hello.txt": "Hello, World!",
  "data.json": JSON.stringify({ foo: "bar" }),
});

await Bun.Archive.write("archive.tar.gz", archive, "gzip");

// Extract to a directory
await archive.extract("./out");
```

#### `CompressionStream` and `DecompressionStream` {% since "1.3.3" improved="1.4.0" /%}

Bun 1.3.3 added the Web-standard [`CompressionStream`](https://developer.mozilla.org/docs/Web/API/CompressionStream) and [`DecompressionStream`](https://developer.mozilla.org/docs/Web/API/DecompressionStream) APIs, supporting the spec formats `gzip`, `deflate`, and `deflate-raw` plus `brotli` and `zstd` as Bun-specific extensions.

```ts
const stream = new Blob([data])
  .stream()
  .pipeThrough(new CompressionStream("gzip"));

const compressed = await new Response(stream).arrayBuffer();
```

#### `URLPattern` {% since "1.3.4" /%}

Bun now implements the [`URLPattern`](https://developer.mozilla.org/docs/Web/API/URLPattern) Web API for declarative URL matching.

```ts
const pattern = new URLPattern({ pathname: "/users/:id" });

pattern.test("https://example.com/users/123"); // true

const result = pattern.exec("https://example.com/users/123");
console.log(result.pathname.groups.id); // "123"
```

#### ML-DSA and ML-KEM in `crypto.subtle` {% since "1.4.0" /%}

`crypto.subtle` supports the NIST post-quantum algorithms:

- ML-DSA (FIPS 204 signatures) at parameter sets 44/65/87, for `sign`/`verify`.
- ML-KEM (FIPS 203 key encapsulation) at 768/1024, via four new `SubtleCrypto` methods: `encapsulateBits`, `encapsulateKey`, `decapsulateBits`, and `decapsulateKey`.

Keys import and export as `spki`, `pkcs8`, `jwk`, `raw-public`, and `raw-seed`. They survive `structuredClone`. [#34838](https://github.com/oven-sh/bun/pull/34838)

```js
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  "ML-KEM-768",
  true,
  ["encapsulateBits", "decapsulateBits"],
);

// Sender: derive a shared secret + ciphertext from the recipient's public key
const { sharedKey, ciphertext } = await crypto.subtle.encapsulateBits(
  { name: "ML-KEM-768" },
  publicKey,
);

// Recipient: recover the same shared secret from the ciphertext
const secret = await crypto.subtle.decapsulateBits(
  { name: "ML-KEM-768" },
  privateKey,
  ciphertext,
);
```

#### ML-DSA and ML-KEM in `node:crypto` {% since "1.4.0" /%}

[`node:crypto`](https://nodejs.org/api/crypto.html) now supports the NIST post-quantum algorithms ML-DSA (FIPS 204 signatures) and ML-KEM (FIPS 203 key encapsulation).

- `generateKeyPair` accepts `ml-dsa-44`/`-65`/`-87` and `ml-kem-768`/`-1024`.
- `sign()` and `verify()` work with ML-DSA keys.
- `createPublicKey`/`createPrivateKey` import PEM, DER, encrypted PKCS#8, and JWK (`kty: "AKP"`).

Seven of Node v26.3.0's upstream `test-crypto-pqc-*` suites now pass byte-for-byte. ML-KEM-512 and SLH-DSA are not yet available, because BoringSSL does not expose them via `EVP_PKEY`. `crypto.encapsulate()`/`decapsulate()` land in a later release. [#34549](https://github.com/oven-sh/bun/pull/34549)

```js
import { generateKeyPairSync, sign, verify } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ml-dsa-65");

const sig = sign(undefined, Buffer.from("hello"), privateKey);
verify(undefined, Buffer.from("hello"), publicKey, sig); // true

publicKey.export({ format: "jwk" });
// { kty: "AKP", alg: "ML-DSA-65", pub: "..." }
```

#### `Response.textStream()` and `Request.textStream()` {% since "1.4.0" /%}

`Request` and `Response` now implement [`textStream()`](https://fetch.spec.whatwg.org/#dom-body-textstream), returning a `ReadableStream<string>` of the body decoded as UTF-8.

```ts
const res = await fetch("https://api.example.com/stream");
for await (const chunk of res.textStream()) {
  process.stdout.write(chunk); // chunk is a string
}
```

Multi-byte characters split across chunk boundaries are reassembled, a leading BOM is stripped, and invalid sequences become U+FFFD. Bun decodes each body backing directly rather than piping bytes through a `TextDecoderStream`, so in-memory bodies emit a single string chunk and `fetch()` responses decode inline as bytes arrive.

#### `process.on("memoryPressure")` {% since "1.4.0" /%}

A new `"memoryPressure"` event on `process` fires when the OS signals low available memory, so applications can drop caches or reap idle subprocesses instead of polling. On macOS, Linux, and Windows, Bun subscribes to the operating system's built-in low-memory notification. The listener does not keep the event loop alive. [#32594](https://github.com/oven-sh/bun/pull/32594)

```ts
process.on("memoryPressure", (level: "warning" | "critical") => {
  cache.clear();
});
```

{% image src="/images/blog/bun-1.4/tweets/memory-pressure.jpg" width="1080" height="638" alt="process 'memoryPressure' event" caption="`process` emits a 'memoryPressure' event when the system runs low on memory (thanks @codebytere!)" /%}

#### `Bun.sliceAnsi()` {% since "1.3.11" improved="1.4.0" /%}

[`Bun.sliceAnsi()`](/docs/runtime/utils) slices a string by terminal column width while preserving ANSI colors and terminal hyperlinks, without splitting emoji or other multi-codepoint characters. It replaces the `slice-ansi` and `cli-truncate` npm packages, is faster than both, and returns the original string when nothing is cut. [#26963](https://github.com/oven-sh/bun/pull/26963)

```ts
// slice-ansi replacement
Bun.sliceAnsi("\x1b[31mhello\x1b[39m", 1, 4); // "\x1b[31mell\x1b[39m"

// cli-truncate replacement
Bun.sliceAnsi("unicorn", 0, 4, "…"); // "uni…"
Bun.sliceAnsi("unicorn", -4, undefined, "…"); // "…orn"
```

#### `Bun.wrapAnsi()` {% since "1.3.7" improved="1.4.0" /%}

[`Bun.wrapAnsi()`](/docs/runtime/utils#bun-wrapansi) is a native, drop-in replacement for the `wrap-ansi` npm package. It word-wraps text to a column width with the same ANSI/hyperlink/Unicode handling as above, and is up to 88x faster than the JavaScript version. [#26061](https://github.com/oven-sh/bun/pull/26061)

```ts
const wrapped = Bun.wrapAnsi("\x1b[31mThe quick brown fox\x1b[39m", 10);
console.log(wrapped);
// \x1b[31mThe quick\x1b[39m
// \x1b[31mbrown fox\x1b[39m
```

#### `Bun.stringWidth()` {% since "1.3.5" improved="1.4.0" /%}

[`Bun.stringWidth()`](/docs/runtime/utils#bun-stringwidth) returns the number of terminal columns a string occupies, accounting for ANSI escape sequences, zero-width Unicode, and multi-codepoint emoji graphemes.

```ts
Bun.stringWidth("hello"); // 5
Bun.stringWidth("\x1b[31mhello\x1b[0m"); // 5  (ANSI color)
Bun.stringWidth("\x1b[5A"); // 0  (cursor movement)
Bun.stringWidth("👨‍👩‍👧"); // 2  (ZWJ sequence, one grapheme)
Bun.stringWidth("🇺🇸"); // 2  (regional indicator pair)
Bun.stringWidth("\x1b]8;;https://bun.sh\x07Bun\x1b]8;;\x07"); // 3 (terminal hyperlink)
```

It strips every kind of ANSI escape code (color, cursor movement, terminal hyperlinks). It also strips zero-width codepoints such as soft hyphen and combining marks. Emoji measure 2 columns each. That includes flag pairs, skin-tone modifiers, keycaps, and multi-part emoji like 👨‍👩‍👧. `util.inspect`, `console.table`, and `readline` use the same implementation. [#25447](https://github.com/oven-sh/bun/pull/25447)

{% stringWidthRuler /%}

`Bun.stringWidth()` is 7–56× faster on Chinese, Japanese, and Korean text.

{% image src="/images/blog/bun-1.4/tweets/stringwidth-cjk.jpg" width="1120" height="1082" alt="Bun.stringWidth() is 7-56x faster on Chinese, Japanese, and Korean characters" caption="Bun.stringWidth() 处理中文、日文、韩文字符的速度提升了 7~56 倍 Bun.stringWidth() が中国語・日本語・韓国語の文字で 7〜56 倍高速化されました Bun.stringWidth()가 중국어·일본어·한국어 문자에서 7~56배 빨라졌습니다" /%}

#### `Bun.spawn({ cgroup })` {% since "1.4.0" /%}

On Linux, [`Bun.spawn()`](/docs/runtime/child-process#resource-limits-with-cgroups-linux) and `Bun.spawnSync()` accept a `cgroup` option. It takes the path of an existing cgroup directory, or an open file descriptor for one. The child is placed in the cgroup before it starts running. So limits such as `memory.max` and `pids.max` apply from its first instruction, and anything it forks stays inside. If the child exceeds its memory limit, the kernel kills it. The parent is unaffected. Bun only joins the cgroup. Create and configure it first (`node:fs` is enough), and remove it when you are done.

```ts
import { mkdirSync, writeFileSync } from "node:fs";

const dir = "/sys/fs/cgroup/build-jobs";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/memory.max`, String(2 * 1024 ** 3));

const proc = Bun.spawn({ cmd: ["make", "-j8"], cgroup: dir });
```

On cgroup v2 the child is created inside the cgroup with `clone3(CLONE_INTO_CGROUP)`. Where that is unavailable, Bun writes the child into `cgroup.procs` before `exec`. A missing directory fails the spawn with the errno and the path. A frozen cgroup is refused with `EBUSY`. Otherwise the child would freeze before `exec` and take the calling thread with it. `node:child_process` forwards the option. Other platforms ignore it. [#37466](https://github.com/oven-sh/bun/pull/37466)

{% lazyVideo src="/images/blog/bun-1.4/tweets/spawn-cgroup.mp4" poster="/images/blog/bun-1.4/tweets/spawn-cgroup-poster.jpg" width=1920 height=1080 label="The cgroup option in Bun.spawn limiting cpu and memory usage of a spawned process on Linux" /%}

#### Async stack traces from native I/O {% since "1.3.12" /%}

Errors thrown from async native APIs like `fs.promises`, `Bun.file()`, `Bun.S3Client`, DNS, crypto, and `fetch` now include async stack traces that point back to the `await` in your code. Previously these errors had empty stacks. There was no JavaScript on the call stack when the error was created in native code, so they were effectively impossible to trace. [#28652](https://github.com/oven-sh/bun/pull/28652)

```js-diff
  ENOENT: no such file or directory, open 'foo.txt'
+       at async foo (/path/to/app.js:5:8)
```

The stack is only captured when an error is constructed for rejection, so successful awaits are unaffected.

#### `--cpu-prof` {% since "1.3.2" /%}

Bun now ships a built-in CPU profiler. Pass `--cpu-prof` to generate a `.cpuprofile` in the Chrome CPU Profiler format. It opens directly in Chrome DevTools or VS Code. `--cpu-prof-md` writes the same profile as a Markdown report: a summary table, top-10 hot functions, self-time and total-time tables, and a call tree. That is useful for pasting into a bug report or feeding to an LLM. `--cpu-prof-name`, `--cpu-prof-dir`, and `--cpu-prof-interval` customize the output path and sampling interval. [#24112](https://github.com/oven-sh/bun/pull/24112) [#26327](https://github.com/oven-sh/bun/pull/26327) [#26620](https://github.com/oven-sh/bun/pull/26620)

```sh
$ bun --cpu-prof ./app.ts
# Writes CPU.20260615.120000.12345.0.001.cpuprofile

$ bun --cpu-prof-md ./app.ts
```

{% image src="/images/blog/bun-1.4/cpu-prof-devtools.png" alt="Chrome DevTools Performance panel showing a bun --cpu-prof profile with the Call tree expanded: render > escapeHtml at 42.3% self time, tokenize at 14.9%." caption="A `bun --cpu-prof` profile opened in Chrome DevTools." /%}

The CPU profiler can be enabled with `BUN_CPU_PROFILE=1` (plus optional `BUN_CPU_PROFILE_DIR` / `BUN_CPU_PROFILE_NAME`) for processes you can't easily pass `--cpu-prof` to. [#26313](https://github.com/oven-sh/bun/pull/26313)

#### `--heap-prof` {% since "1.3.7" /%}

`--heap-prof` generates a V8-compatible `.heapsnapshot` that opens directly in Chrome DevTools, and `--heap-prof-md` emits a grep-friendly Markdown report with total heap size, top types by retained size, and the largest individual objects. `--heap-prof-name` and `--heap-prof-dir` control where the output lands.

```sh
# V8-compatible heap snapshot (opens in Chrome DevTools)
$ bun --heap-prof script.js

# Markdown heap profile for CLI analysis
$ bun --heap-prof-md script.js
```

#### `--no-env-file` {% since "1.3.3" /%}

A new `--no-env-file` flag (and `env = false` in [`bunfig.toml`](/docs/runtime/bunfig)) disables Bun's automatic [`.env` loading](/docs/runtime/environment-variables#disabling-automatic-env-loading). This is useful in production and CI. There, environment variables are managed externally and stray `.env` files should be ignored. Explicit `--env-file` arguments are still honored. [#24767](https://github.com/oven-sh/bun/pull/24767)

```sh
$ bun --no-env-file server.ts
```

```toml
# bunfig.toml
env = false
```

#### `--no-orphans` {% since "1.3.14" improved="1.4.0" /%}

A new `--no-orphans` flag (and [`[run] noOrphans = true`](/docs/runtime/bunfig#run-noorphans---dont-leave-orphan-processes-behind) in bunfig, or `BUN_FEATURE_FLAG_NO_ORPHANS=1`) makes Bun exit when its original parent process dies. It also recursively SIGKILLs all descendants on clean exit. So when your terminal dies, your dev servers die with it. It works on Linux and macOS with no extra thread or file descriptor. On Windows it uses a recursive kill-on-close Job Object plus a parent-process wait ([#34768](https://github.com/oven-sh/bun/pull/34768)). It applies to `bun run <script>`, `bunx`, and `--filter`. [#29930](https://github.com/oven-sh/bun/pull/29930)

```sh
$ bun --no-orphans run dev
```

{% image src="/images/blog/bun-1.4/tweets/no-orphans.jpg" width="1262" height="1298" alt="bun --no-orphans terminating lingering child processes on exit" caption="`bun --no-orphans <file|script>` recursively terminates lingering processes on exit" /%}

#### `Bun.Transpiler` REPL mode {% since "1.3.7" /%}

A new `replMode` option transforms code for interactive REPL evaluation: it captures the last expression's value, hoists declarations so they persist across lines, converts `const` to `let` for re-declaration, and auto-detects bare object literals. Pair it with `vm.runInContext` to build a Node.js-compatible REPL on Bun's transpiler. [#26246](https://github.com/oven-sh/bun/pull/26246)

#### `Bun.YAML` passes 402/402 of yaml-test-suite {% since "1.4.0" /%}

`Bun.YAML` now passes 402/402 yaml-test-suite. This fixes spec-compliance bugs in:

- explicit `?` keys
- tab indentation
- `{}`-style mappings
- `&` anchors on empty values
- `---`/`...` appearing mid-line
- the indent and newline-trim modifiers on `|`/`>` strings

`YAML.stringify()` also now correctly quotes number-like strings (`"0e6836"`, `"0123"`), strings ending in `:`, and strings starting with `[`/`{`. Cyclic anchors and aliases are supported in `parse()`. [#31527](https://github.com/oven-sh/bun/pull/31527) [#37055](https://github.com/oven-sh/bun/pull/37055)

{% image src="/images/blog/bun-1.4/tweets/yaml-cyclic-anchors.jpg" width="1106" height="576" alt="Bun.YAML.parse supports cyclic anchors and aliases" caption="`Bun.YAML.parse` supports cyclic anchors & aliases" /%}

#### `WebSocket` proxies and Unix sockets {% since "1.3.6" improved="1.4.0" /%}

The `WebSocket` client now supports connecting through HTTP and HTTPS proxies via a new `proxy` option. It supports `ws://` and `wss://` over both HTTP and HTTPS proxies, Basic auth via URL credentials, custom proxy headers, and full TLS configuration for the target connection. It also supports Unix domain sockets via `ws+unix://` and `wss+unix://` URL schemes. These use the same syntax as the npm ws package. [#25614](https://github.com/oven-sh/bun/pull/25614) [#29203](https://github.com/oven-sh/bun/pull/29203)

```ts
new WebSocket("wss://example.com", { proxy: "http://user:pass@proxy:8080" });

new WebSocket("ws+unix:///tmp/app.sock:/api/stream?x=1");
```

#### `WebSocket` URL credentials {% since "1.3.7" improved="1.4.0" /%}

`new WebSocket("ws://user:pass@host")` now forwards URL-embedded credentials as a Basic `Authorization` header. An explicitly provided `Authorization` header still takes precedence. [#26278](https://github.com/oven-sh/bun/pull/26278)

#### SHA-3 and X25519 in Web Crypto {% since "1.3.13" /%}

SHA-3 lands in both Web Crypto and `node:crypto`. `crypto.subtle.digest()` and HMAC `sign`/`verify` now accept `SHA3-256`/`SHA3-384`/`SHA3-512`. `createHash`/`createHmac` add `sha3-224/256/384/512`. `crypto.subtle.deriveBits` now supports X25519 as well, for deriving a shared secret between two key pairs. Small-order peer public keys are rejected, as RFC 7748 requires. [#29323](https://github.com/oven-sh/bun/pull/29323) [#29152](https://github.com/oven-sh/bun/pull/29152)

```ts
await crypto.subtle.digest("SHA3-256", new TextEncoder().encode("hello"));

const bits = await crypto.subtle.deriveBits(
  { name: "X25519", public: bobPublicKey },
  alicePrivateKey,
  256,
);
```

#### `structuredClone` preserves object identity {% since "1.4.0" /%}

`structuredClone` preserves object identity for `Date`, `RegExp`, `Error` subclasses, `DOMException`, `CryptoKey`, `KeyObject`, `X509Certificate`, `Blob`, and `File`: the same instance referenced twice comes back as one object. [#32796](https://github.com/oven-sh/bun/pull/32796)

#### `Bun.CSRF` `sessionId` {% since "1.4.0" /%}

`Bun.CSRF.generate()` and `Bun.CSRF.verify()` accept a new `sessionId` option that binds a token to a specific principal via HMAC associated data. Tokens generated for one session won't verify under another, and verification fails closed if `sessionId` is supplied on only one side; tokens without `sessionId` are unchanged. [#31215](https://github.com/oven-sh/bun/pull/31215)

#### `Bun.udpSocket()` connection-refused errors and truncation flags {% since "1.3.12" /%}

On Linux, sending to a dead port now fires the `error` handler with `ECONNREFUSED` instead of silently timing out. The `data` callback also gains a fifth `flags` argument with `{ truncated: boolean }` to detect when a datagram exceeded the receive buffer. [#28827](https://github.com/oven-sh/bun/pull/28827)

#### Grapheme clusters for Indic scripts {% since "1.3.7" /%}

We rewrote grapheme cluster segmentation with Indic Conjunct Break support. Devanagari and other Indic conjuncts now segment as single clusters. [#26376](https://github.com/oven-sh/bun/pull/26376)

#### `Bun.S3Client` {% since "1.3.1" improved="1.4.0" /%}

`Bun.S3Client` now supports AWS Requester Pays buckets. Pass `requestPayer: true` on the client or per-operation to send the `x-amz-request-payer` header on every request, including each part of a multipart upload. [#25514](https://github.com/oven-sh/bun/pull/25514)

```ts
const s3 = new Bun.S3Client({
  bucket: "hl-mainnet-evm-blocks",
  requestPayer: true,
});
const data = await s3.file("0/0/1.rmp.lz4").arrayBuffer();
```

Other S3 fixes:

- `write()` and `writer()` now accept `contentDisposition` and `contentEncoding`.
- `presign()` honors `contentDisposition` and `type`.
- `slice(0, N).stream()` sends the correct `Range` header.
- `queueSize` is respected instead of being silently overridden to 255.
- A memory leak in `list()` has been fixed.

[#25363](https://github.com/oven-sh/bun/pull/25363) [#26149](https://github.com/oven-sh/bun/pull/26149) [#25999](https://github.com/oven-sh/bun/pull/25999) [#27273](https://github.com/oven-sh/bun/pull/27273) [#29813](https://github.com/oven-sh/bun/pull/29813) [#23880](https://github.com/oven-sh/bun/pull/23880)

#### `Bun.sql` is more reliable {% since "1.3.11" improved="1.4.0" /%}

```ts
const sql = new Bun.SQL({ prepare: false });
await sql`SELECT 1`; // now safe behind PgBouncer transaction pooling
```

- **PgBouncer transaction pooling**: with `prepare: false`, Bun now sends each query in a single round-trip instead of two, so PgBouncer can no longer split it across Postgres connections and return the wrong query's results. [#27952](https://github.com/oven-sh/bun/pull/27952)
- **Docker startup windows**: when a pooled connection is accepted then closed before the handshake completes (as happens with Docker while a containerized database is still starting), Bun now retries with exponential backoff until `connectionTimeout` elapses instead of failing every waiting query. [#32028](https://github.com/oven-sh/bun/pull/32028)

#### Named parameters in `Bun.sql` for SQLite {% since "1.4.0" /%}

`sql.unsafe()` and `sql.file()` accept an object of named parameters for `:name`, `$name`, and `@name` placeholders. Previously an object bound nothing, so a `SELECT` returned no rows and no error. Keys keep their prefix (`{ ":id": 1 }`) unless the connection sets `strict: true`. [#37109](https://github.com/oven-sh/bun/pull/37109)

#### SQLite 3.53.0 {% since "1.3.14" /%}

`bun:sqlite`'s bundled SQLite is upgraded to **3.53.0**; `db.close(true)` no longer throws "database is locked" after `db.transaction()`; non-UTF-8 `TEXT` values under 64 bytes decode leniently to U+FFFD instead of returning `""`. [#27912](https://github.com/oven-sh/bun/pull/27912)

#### `Bun.isStandaloneExecutable` {% since "1.4.0" /%}

`Bun.isStandaloneExecutable` is a new read-only boolean, `true` inside a `bun build --compile` binary; unlike checking `Bun.embeddedFiles.length > 0`, reading it allocates nothing. [#32583](https://github.com/oven-sh/bun/pull/32583)

#### `bun init --react=tanstack` {% since "1.3.4" /%}

`bun init --react=tanstack` is a new template that scaffolds a TanStack Start project with file-based routing, Vite, and Tailwind, running on Bun. [#24648](https://github.com/oven-sh/bun/pull/24648)

### Test runner

#### `onTestFinished()` {% since "1.3.2" /%}

`bun:test` exports `onTestFinished()`, a Vitest-compatible hook that registers a callback to run after the current test completes, after all `afterEach` hooks. It can only be called inside a test body, so you can clean up resources that were created during the test. [#24038](https://github.com/oven-sh/bun/pull/24038)

```ts
import { test, onTestFinished } from "bun:test";

test("uses a temp resource", () => {
  const handle = open();
  onTestFinished(() => handle.close());
  // ...
});
```

#### `bun test --only-failures` {% since "1.3.1" /%}

`bun test --only-failures` suppresses output for passing and skipped tests, printing only failures and the final summary. [#23312](https://github.com/oven-sh/bun/pull/23312)

```sh
$ bun test --only-failures

test/example.test.ts:
(fail) failing test
error: expect(received).toBe(expected)

Expected: 3
Received: 2

5 pass
1 skip
1 fail
Ran 7 tests across 1 file.
```

#### `bun test --path-ignore-patterns` {% since "1.3.11" /%}

`bun test --path-ignore-patterns` (and `test.pathIgnorePatterns` in bunfig.toml) excludes test files by glob, so you can skip integration tests, generated fixtures, or whole directories without renaming files. [#28089](https://github.com/oven-sh/bun/pull/28089)

#### `bun test --pass-with-no-tests` {% since "1.3.1" /%}

`bun test --pass-with-no-tests` exits with code 0 when no tests match, matching Jest and Vitest. Useful in monorepos where a shared pattern runs across packages that may not all contain tests. [#23424](https://github.com/oven-sh/bun/pull/23424)

#### `bun test --grep` {% since "1.3.6" /%}

`bun test` now accepts `--grep` as an alias for `-t` / `--test-name-pattern`, matching Mocha and Jest. [#25788](https://github.com/oven-sh/bun/pull/25788)

#### `using spy = spyOn(...)` {% since "1.3.9" /%}

`spyOn()` and `mock()` now implement `Symbol.dispose`, so `using spy = spyOn(obj, "method")` automatically restores the original implementation when the spy goes out of scope. No manual `mockRestore()` or `afterEach` cleanup needed. [#26692](https://github.com/oven-sh/bun/pull/26692)

#### The `vi` global {% since "1.3.1" improved="1.4.0" /%}

The `vi` global (Vitest compatibility alias) is now defined in `bun test`, so files that call `vi.fn()` or `vi.mock()` without importing run unmodified. [#23674](https://github.com/oven-sh/bun/pull/23674)

#### Timeouts on `beforeAll` / `afterAll` hooks {% since "1.3.2" improved="1.4.0" /%}

`beforeAll`, `beforeEach`, `afterAll`, and `afterEach` now accept a numeric timeout or `{ timeout }` options object as the second argument instead of throwing. [#24039](https://github.com/oven-sh/bun/pull/24039)

### Node.js compatibility

#### `node:http` {% since "1.3.4" improved="1.4.0" /%}

The [`node:http`](https://nodejs.org/api/http.html) client has been [rewritten as a direct port of Node's `_http_client.js`](https://github.com/oven-sh/bun/pull/31587). It replaces the previous `fetch()`-based shim. `http.ClientRequest` now runs on `net`/`tls` sockets, Node's own HTTP parser, and an `Agent` socket pool. So keep-alive reuse, `Upgrade`/`CONNECT`, 1xx `'information'` events, and `createConnection` all behave exactly as they do in Node.

```js
import http from "node:http";

const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });

const req = http.request({ host: "example.com", agent }, (res) => {
  res.on("data", (chunk) => process.stdout.write(chunk));
});
req.on("information", (info) => console.log("1xx:", info.statusCode));
req.end();
```

Keep-alive agents reuse sockets exactly as in Node: subsequent requests through an `http.Agent` with `keepAlive: true` are **65.9% faster**, with **190% higher** overall throughput. [#24351](https://github.com/oven-sh/bun/pull/24351)

On the server, `headersTimeout`, `requestTimeout`, and `keepAliveTimeout` fire with Node's `connectionsCheckingInterval` sweep and raw `408` reply. Also:

- HTTP/1.1 pipelining is supported with `maxRequestsPerSocket`.
- `closeIdleConnections()` and `closeAllConnections()` count correctly.
- Connection sockets are real `net.Socket` instances with Node's `'connection'`/`'clientError'`/`'close'` lifecycle.
- Per-server `insecureHTTPParser` and `maxHeaderSize` are honored.

```js
import http from "node:http";

const server = http.createServer((req, res) => res.end("ok"));
server.headersTimeout = 10_000; // 408 if headers not complete in 10s
server.requestTimeout = 30_000; // 408 if request not complete in 30s
server.keepAliveTimeout = 5_000; // close idle keep-alive sockets after 5s
server.listen(3000);
```

#### `node:http2` {% since "1.4.0" /%}

[`node:http2`](https://nodejs.org/api/http2.html) has a spec-compliant HTTP/2 parser. Server push works end to end via `pushStream()` and `createPushResponse()`, and Node API parity now covers raw headers, graceful connection shutdown, and `respondWithFD`. **93.2%** of Node v26.3.0's byte-identical test suite passes. [#31584](https://github.com/oven-sh/bun/pull/31584)

```js
import http2 from "node:http2";

const server = http2.createSecureServer({ key, cert });
server.on("stream", (stream, headers) => {
  stream.pushStream({ ":path": "/app.css" }, (err, push) => {
    push.respondWithFile("./public/app.css", { "content-type": "text/css" });
  });
  stream.respond({ ":status": 200, "content-type": "text/html" });
  stream.end("<link rel=stylesheet href=/app.css>");
});
```

#### `node:net` and `node:tls` {% since "1.4.0" /%}

`socket.end()` now half-closes the connection instead of full-closing it. `resetAndDestroy()`, write-after-end errors, and `ECONNRESET` shapes are now correct. `net.Socket#connect()` and `Bun.connect()` accept `localAddress` and `localPort`. These bind outgoing sockets to a specific local interface. TLS gains:

- `'session'` and `'keylog'` events
- structured OpenSSL errors (`err.code`/`err.library`/`err.reason`)
- `SNICallback`/`ALPNCallback`
- PFX support

[#31155](https://github.com/oven-sh/bun/pull/31155)

```js
import tls from "node:tls";
import { appendFileSync } from "node:fs";

const socket = tls.connect(443, "example.com", { servername: "example.com" });
socket.on("keylog", (line) => appendFileSync("keys.log", line)); // for Wireshark decryption
socket.on("session", (session) => {
  // Session ticket for TLS resumption
});
```

#### `node:worker_threads` {% since "1.4.0" /%}

A worker with an unsettled top-level `await` exits with code 13. `process.abort()` inside a worker ends only that worker. [`node:worker_threads`](https://nodejs.org/api/worker_threads.html) gains:

- `postMessageToThread()` and the `'workerMessage'` event
- `markAsUntransferable`/`markAsUncloneable`
- `env: SHARE_ENV`
- captured stdio (`{ stdout: true }`)
- worker introspection (`getHeapStatistics()`, `cpuUsage()`, `startCpuProfile()`)

`MessagePort`'s `close()` callback timing, `'close'` event delivery to both ends of a channel, and `DataCloneError` transfer-list messages now pass Node's own suite. That suite is at **73.9%** overall, up from ~37% in Bun 1.3.

```js
import { Worker, SHARE_ENV } from "node:worker_threads";

const w = new Worker("./worker.js", {
  env: SHARE_ENV, // live, write-through process.env
  stdout: true, // captured stdio
});
w.stdout.pipe(process.stdout);

const stats = await w.getHeapStatistics();
```

#### `node:fs` {% since "1.4.0" /%}

`fs.cp` and `cpSync` get Node's full `ERR_FS_CP_*` error semantics, `fs.watch` gains the `ignore` option, and `fs.promises.watch` gains `AbortSignal` support. [`node:fs`](https://nodejs.org/api/fs.html) now passes **97.5%** of Node v26.3.0's fs tests (**99.1%** excluding tests that require `--expose-internals`).

```js
import { watch } from "node:fs/promises";

const ac = new AbortController();
for await (const { eventType, filename } of watch("./src", {
  recursive: true,
  ignore: (path) => path.includes("node_modules"),
  signal: ac.signal,
})) {
  console.log(eventType, filename);
}
```

#### `node:stream` {% since "1.4.0" /%}

The experimental `stream/iter` and `zlib/iter` APIs land behind `--experimental-stream-iter`, `readable.read()` returns one buffered chunk at a time (Node 26's semver-major change), and `pipeline()` reports the real failure ahead of any internal `AbortError`. [`node:stream`](https://nodejs.org/api/stream.html) passes **96.9%** of Node v26.3.0's stream tests.

```js
// bun --experimental-stream-iter app.js
import { map, filter } from "node:stream/iter";
import { createReadStream } from "node:fs";

const lines = createReadStream("access.log", "utf8");
for await (const hit of filter(
  map(lines, (l) => l.trim()),
  (l) => l.includes("POST"),
)) {
  console.log(hit);
}
```

#### `process` {% since "1.4.0" /%}

Setting `process.env.TZ` now updates existing `Date` instances. `process.env` now behaves like Node's: assigned values are coerced to strings, and `structuredClone(process.env)` works. `--no-warnings`, `--trace-warnings`, `--trace-deprecation`, `--redirect-warnings`, and `--disable-warning` are all wired up. [`process`](https://nodejs.org/api/process.html) jumps from 60.5% to **84.2%** on Node v26.3.0's tests. [#31831](https://github.com/oven-sh/bun/pull/31831)

```js
const now = new Date();
process.env.TZ = "America/Los_Angeles";
console.log(now.toString()); // existing Date reflects the new timezone

process.env.PORT = 3000;
console.log(process.env.PORT); // "3000" (coerced to string)
```

#### `AsyncLocalStorage` {% since "1.4.0" /%}

[`AsyncLocalStorage`](https://nodejs.org/api/async_context.html) gains the Node 26 `defaultValue`/`name` constructor options and `AsyncLocalStorage.prototype.withScope()`. `AsyncResource.bind()` now preserves the original function's `.length` and `this`. Coverage of Node's `async_hooks` tests [doubles to **50%**](https://github.com/oven-sh/bun/tree/main/test/js/node/test/parallel). [#31825](https://github.com/oven-sh/bun/pull/31825)

```js
import { AsyncLocalStorage } from "node:async_hooks";

const requestId = new AsyncLocalStorage({
  name: "requestId",
  defaultValue: "-",
});

{
  using scope = requestId.withScope(crypto.randomUUID());
  console.log(requestId.getStore()); // the UUID
}
console.log(requestId.getStore()); // "-"
```

#### `node:vm` {% since "1.4.0" /%}

Top-level `await` in a `SourceTextModule` resumes after the `await`, and [`node:vm`](https://nodejs.org/api/vm.html) adds the v26 module-linking API (`linkRequests()`, `instantiate()`, `moduleRequests`, `hasTopLevelAwait()`) and implements `microtaskMode: 'afterEvaluate'`, taking Node v26.3.0's vm suite from 72% to **97%**. [#32018](https://github.com/oven-sh/bun/pull/32018)

```js
import vm from "node:vm";

const ctx = vm.createContext({ console }, { microtaskMode: "afterEvaluate" });
const mod = new vm.SourceTextModule(
  `export const n = await Promise.resolve(42);`,
  { context: ctx },
);
await mod.linkRequests(() => {});
mod.instantiate();
await mod.evaluate();
console.log(mod.namespace.n); // 42
```

#### `node:cluster` {% since "1.4.0" /%}

[`node:cluster`](https://nodejs.org/api/cluster.html) shares sockets between workers. Bun 1.4 implements round-robin scheduling (the primary accepts connections and hands the file descriptors to workers over IPC), `SCHED_NONE` shared handles, UDP clustering, and `worker.send(msg, socket)` handle passing. [#31829](https://github.com/oven-sh/bun/pull/31829)

```js
import cluster from "node:cluster";
import http from "node:http";
import { availableParallelism } from "node:os";

if (cluster.isPrimary) {
  for (let i = 0; i < availableParallelism(); i++) cluster.fork();
} else {
  http
    .createServer((req, res) => res.end(`hello from ${process.pid}`))
    .listen(3000);
}
```

#### `vitest --coverage` {% since "1.4.0" /%}

[`node:inspector`](https://nodejs.org/api/inspector.html) now implements the V8 `Profiler` coverage methods, so `vitest --coverage` with the default v8 provider works under Bun. Per-file statement, branch, function, and line percentages, and the uncovered-line report, match Node exactly on the same project. [#32476](https://github.com/oven-sh/bun/pull/32476)

```sh
$ bun --bun vitest run --coverage
 % Coverage report from v8
-----------|---------|----------|---------|---------|-------------------
File       | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------|---------|----------|---------|---------|-------------------
All files  |   87.43 |    76.19 |   88.88 |   87.43 |
```

#### `chrome://inspect` {% since "1.4.0" /%}

`inspector.open()`, `inspector.url()`, `inspector.close()`, and `inspector.waitForDebugger()` are implemented. Bun starts a WebSocket server that speaks the Chrome DevTools Protocol. It serves the same discovery endpoints as Node and prints Node's `Debugger listening on ws://...` line. So `chrome://inspect` and VS Code's debugger discover and attach to a running Bun process. [#32479](https://github.com/oven-sh/bun/pull/32479)

```js
import inspector from "node:inspector";

inspector.open(9229, "127.0.0.1");
console.log(inspector.url()); // ws://127.0.0.1:9229/...
inspector.waitForDebugger(); // blocks until DevTools attaches
```

#### `node:test` {% since "1.4.0" /%}

Subtests work. `t.test()`, `t.describe()`, and top-level `test()`/`describe()` called inside a running test now execute inline instead of throwing `NotImplementedError`. [`node:test`](https://nodejs.org/api/test.html) also gains:

- `t.plan()` and `t.waitFor()`
- `getTestContext()`
- `mock.timers` and `mock.property()`
- runtime `t.skip()`/`t.todo()`
- test tags
- custom assertions via `assert.register()`
- `(t, done) => {}` callback tests

`t.mock` is now a per-test tracker. It resets automatically when the test finishes. **20** of Node v26.3.0's `test_runner` tests now pass, up from 7. [#32631](https://github.com/oven-sh/bun/pull/32631)

```js
import { test } from "node:test";

test("parent", async (t) => {
  t.plan(2);
  await t.test("a", () => {});
  await t.test("b", () => {});
});

test("timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let fired = false;
  setTimeout(() => (fired = true), 1000);
  t.mock.timers.tick(1000);
  t.assert.strictEqual(fired, true);
});
```

[`node:test`](https://nodejs.org/api/test.html) gains the programmatic `run()` API. Each file runs in its own child process. The returned `TestsStream` emits Node's event sequence (`test:enqueue`/`dequeue`, `test:pass`/`fail`, per-file and run-level `test:summary`) as both events and objectMode chunks. Node v26's `expectFailure` option lands. A throwing body is the expected outcome. A passing one fails with `failureType: 'expectedFailure'`. Two divergences reachable from plain `bun test` are also fixed. A skipped `describe` no longer runs its callback. `{ skip: true, todo: true }` is treated as a skip. Node v26.3.0's `test_runner` suite goes from 20 to **26 of 81** passing. [#34444](https://github.com/oven-sh/bun/pull/34444)

```js
import { run } from "node:test";

const stream = run({ files: ["./a.test.js", "./b.test.js"] });
stream.on("test:fail", ({ name, details }) =>
  console.error(name, details.error.message),
);
```

#### `node:quic` {% since "1.4.0" /%}

[`node:quic`](https://nodejs.org/api/quic.html) is now implemented. It is backed by lsquic, which Bun already vendors for HTTP/3. The full experimental Node v26 API is covered:

- `listen()` and `connect()`
- bidirectional and unidirectional streams
- HTTP/3 and raw-QUIC applications
- datagrams
- 0-RTT session resumption
- path migration
- stateless resets
- per-SNI certificates
- qlog and keylog

All **235** vendored Node v26.3.0 `node:quic` tests pass on a release build. [#32602](https://github.com/oven-sh/bun/pull/32602)

Bun-to-Bun runs at **1.31×** Node-to-Node throughput (64,591 vs 49,239 req/s, one HTTP/3 stream per request at concurrency 50, Linux x64). Node's published binaries compile QUIC out, so running the same code there requires a from-source `--experimental-quic` build.

```js
import { listen } from "node:quic";

const endpoint = await listen(
  (session) => {
    session.onstream = (stream) => stream.closed.catch(() => {});
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    onheaders() {
      this.sendHeaders({ ":status": "200" });
      this.writer.endSync();
    },
  },
);
```

#### `node:sqlite` {% since "1.3.2" improved="1.4.0" /%}

[`node:sqlite`](https://nodejs.org/api/sqlite.html) is now implemented. It passes all 18 of Node v26.3.0's `test-sqlite-*` files (319 subtests, 0 failures, 4 skips, on Linux x64). macOS skips more, because Apple's system libsqlite3 omits some features. It is backed by the same bundled SQLite as `bun:sqlite`. Supported:

- `DatabaseSync` and `StatementSync`
- `backup()`
- sessions and changesets
- user-defined scalar, aggregate, and window functions
- the authorizer callback
- `process.versions.sqlite`

[#32498](https://github.com/oven-sh/bun/pull/32498)

```js
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE data(key INTEGER PRIMARY KEY, value TEXT) STRICT`);

const insert = db.prepare("INSERT INTO data (key, value) VALUES (?, ?)");
insert.run(1, "hello");
insert.run(2, "world");

console.log(db.prepare("SELECT * FROM data ORDER BY key").all());
// [ { key: 1, value: 'hello' }, { key: 2, value: 'world' } ]
```

{% image src="/images/blog/bun-1.4/tweets/node-sqlite.jpg" width="1320" height="1387" alt="node:sqlite is fully implemented and passes 100% of Node.js's test suite" caption="node:sqlite is fully implemented and passes 100% of Node.js’ test suite" /%}

- `vm.Script`, `vm.SourceTextModule`, and `vm.compileFunction` release their results to GC; a GC-root cycle between the script and its fetcher retained every call forever, so after 500 iterations and a GC, retained `Script` objects drop from +500 to +0. [#28493](https://github.com/oven-sh/bun/pull/28493)
- `fs.createReadStream().pipe(serverResponse)` completes when `ServerResponse` is used standalone without an underlying socket; `writableNeedDrain` defaulted to `true`, pausing piped streams, which broke Vite's static file serving and other connect-to-web middleware adapters. [#24137](https://github.com/oven-sh/bun/pull/24137)
- `Module._resolveFilename` forwards `options.paths` to overridden resolvers and honors custom paths when called directly, which `bun --bun next build` on Next.js 16 + React Compiler + Turbopack depends on. [#24325](https://github.com/oven-sh/bun/pull/24325)

#### `node:repl` {% since "1.4.0" /%}

[`node:repl`](https://nodejs.org/api/repl.html) is now a working port of Node v26.3.0's REPL. Before, it was a stub that threw on use. It passes **75.2%** of Node's repl tests. This includes line editing and keybindings, multi-line continuation (unfinished statements get a `| ` prompt instead of a syntax error), top-level `await`, tab completion, and persistent history. A new `--interactive` flag drops you straight into it. For interactive use, prefer [`bun repl`](#bun-repl), which has Bun-specific features like syntax highlighting. `--interactive` and `node:repl` are for tools that programmatically embed Node's REPL. [#31827](https://github.com/oven-sh/bun/pull/31827)

```sh
$ bun --interactive
> const res = await fetch("https://bun.sh")
> res.status
200
```

#### `node:trace_events` {% since "1.4.0" /%}

[`node:trace_events`](https://nodejs.org/api/tracing.html) is now fully implemented. It passes **100%** of Node v26.3.0's trace tests. Bun supports `--trace-events-enabled`, `--trace-event-categories`, and `--trace-event-file-pattern`. It writes `node_trace.${rotation}.log` in Chrome trace format. It instruments timers, fs, and http with category-gated events that are zero-cost when tracing is off. [#31824](https://github.com/oven-sh/bun/pull/31824)

```sh
$ bun --trace-events-enabled --trace-event-categories=node.fs.async,node.http app.js
$ ls node_trace.*.log
node_trace.1.log
```

#### `node:domain`

[`node:domain`](https://nodejs.org/api/domain.html) is now a real implementation instead of a ~70-line stub. It passes **66.7%** of Node's domain tests. Domains propagate via Bun's `AsyncLocalStorage` machinery. Uncaught exceptions route into the active domain before `'uncaughtException'`. `EventEmitter` integrates with domains the same way it does in Node. [#31828](https://github.com/oven-sh/bun/pull/31828)

```js
import domain from "node:domain";

const d = domain.create();
d.on("error", (err) => console.error("caught by domain:", err.message));
d.run(() => {
  setTimeout(() => {
    throw new Error("boom");
  }, 10);
});
```

#### `node:buffer` {% since "1.4.0" /%}

[`node:buffer`](https://nodejs.org/api/buffer.html) now passes **92.9%** (65/70) of Node.js v26.3.0's `test-buffer*.js` suite. `Buffer.indexOf`/`lastIndexOf`/`includes` gain the `end` parameter. `Buffer.concat`/`copy` range validation matches Node. `ERR_INVALID_ARG_TYPE`/`ERR_OUT_OF_RANGE` messages are formatted identically to Node's, including grouped type lists and numeric separators for large values. [#32626](https://github.com/oven-sh/bun/pull/32626)

`Buffer.byteLength()` no longer under-counts unpaired surrogates, so it agrees with `Buffer.from(s).length`, and `lastIndexOf` with `utf16le` encoding no longer matches on odd byte offsets. [#32784](https://github.com/oven-sh/bun/pull/32784)

```js
const s = "\ud800a".repeat(17);
Buffer.byteLength(s, "utf8"); // before: 51, after: 68
Buffer.from(s, "utf8").length; // 68 (now matches)
```

#### `TextDecoder` supports all WHATWG encodings {% since "1.4.0" /%}

`TextDecoder` now supports every encoding in the Encoding Standard. Sixteen previously-missing single-byte encodings (`iso-8859-2`, `-5`, `-16`, `koi8-r`, `windows-1251`, and others) are added, all 228 spec labels are recognized, and EUC-JP, Big5, ISO-2022-JP, and BOM handling during streaming decode now match the spec byte-for-byte. [#32837](https://github.com/oven-sh/bun/pull/32837)

```js
new TextDecoder("iso-8859-5"); // no longer throws RangeError
new TextDecoder("csisolatin5"); // label alias, also works
```

#### `uid` and `gid` for child processes {% since "1.4.0" /%}

`Bun.spawn`, `Bun.spawnSync`, and [`node:child_process`](https://nodejs.org/api/child_process.html) now honor the `uid` and `gid` options. They change the child's user and group IDs before exec. Behavior matches Node/libuv: `setgroups` then `setgid` then `setuid` on POSIX, and `ENOTSUP` on Windows. `EPERM` is surfaced synchronously when the caller lacks permission. [#33060](https://github.com/oven-sh/bun/pull/33060)

```js
import { spawnSync } from "node:child_process";

// as root:
spawnSync("id", { uid: 65534, gid: 65534 });
// child reports uid=65534 gid=65534, supplementary groups dropped
```

#### `NODE_COMPILE_CACHE` {% since "1.4.0" /%}

[`module.enableCompileCache()`](https://nodejs.org/api/module.html#moduleenablecompilecachecachedir) and the `NODE_COMPILE_CACHE` environment variable now persist bytecode to disk between runs. `--cpu-prof` and `--heap-prof` write V8-format profiles with Node's filename convention. `--watch-kill-signal` delivers the configured signal to JS listeners before restarting. The Node 26 [`Assert` class](https://nodejs.org/api/assert.html#class-assertassert) and a native `assert.partialDeepStrictEqual` are implemented. Throws inside `fs`/`dns`/`pbkdf2` callbacks now route to `'uncaughtException'` instead of `'unhandledRejection'`. [`node:url`](https://nodejs.org/api/url.html) reaches **83.0%** on Node's test suite. `new URL(bad)` throws Node's exact `TypeError: Invalid URL` shape. [#34660](https://github.com/oven-sh/bun/pull/34660)

```sh
$ NODE_COMPILE_CACHE=~/.cache/bun bun app.js
```

#### Datadog continuous profiling works {% since "1.4.0" /%}

`dd-trace` with `profiling: true` and [`@datadog/pprof`](https://www.npmjs.com/package/@datadog/pprof) now load and profile in Bun. `v8::CpuProfiler` is backed by JavaScriptCore's sampling profiler. The nan `ObjectWrap` template pattern (`FunctionTemplate::SetClassName`, `InstanceTemplate`, `PrototypeTemplate`, `Signature`) is implemented. So are the rest of the 89 V8 and Node symbols pprof's prebuild links against. The returned profile correctly attributes wall-clock samples to the hot function with full stack depth. [#36747](https://github.com/oven-sh/bun/pull/36747)

```js
import { time } from "@datadog/pprof";

time.start({ intervalMicros: 1000 });
// ... code to profile ...
const profile = await time.stop(); // pprof-format profile
```

#### `await worker.terminate()` waits for the thread {% since "1.4.0" /%}

Worker threads are joined by their parent. `await worker.terminate()` resolves with the exit code only once the thread is gone, and every worker it spawned too. Everything the worker posted before exiting is delivered before `'exit'`. A worker's "may run script" gate closes the moment its stop is requested. So no timer, socket callback, or thread-pool completion dispatches into a worker that is being stopped. Off-thread completions reach their VM through a handle that teardown closes. A late one is refused and released instead of touching freed memory.

```js
import { Worker } from "node:worker_threads";

const w = new Worker("./heavy.js");
const code = await w.terminate(); // resolves 1 for a running worker
// the thread and its nested workers are gone
```

This work landed in [#38299](https://github.com/oven-sh/bun/pull/38299), [#38436](https://github.com/oven-sh/bun/pull/38436), [#38457](https://github.com/oven-sh/bun/pull/38457), and [#38660](https://github.com/oven-sh/bun/pull/38660).

The event loop stays fair under a worker that posts faster than its parent can deserialize: message drains take a bounded budget per turn, so a message flood no longer starves timers, I/O, or the worker's own pending stop.

#### Node-API version 10 {% since "1.4.0" /%}

Bun now reports Node-API version 10, syncs the public headers from Node 26, and implements the five `NAPI_EXPERIMENTAL` `node_api_*` functions Node 26 added. [#34146](https://github.com/oven-sh/bun/pull/34146) [#36804](https://github.com/oven-sh/bun/pull/36804) [#34147](https://github.com/oven-sh/bun/pull/34147)

#### N-API finalizers run in LIFO order at exit {% since "1.3.13" /%}

`napi_wrap` finalizers now run in LIFO order at process exit. This fixes shutdown segfaults in kuzu, duckdb, sqlite3, node-llama-cpp, and @napi-rs/canvas. Two crashes in `napi_create_external_buffer` and UTF-8 property-name handling were fixed. This unblocks napi-rs addons like `impit`. `ThreadSafeFunction` finalizer cleanup no longer crashes or hangs. `napi_delete_reference` is now callable from inside a finalizer. `napi_typeof` correctly reports wrapped callbacks and boxed primitives.

#### `tls.setDefaultCACertificates()` and `secureContext.addCACert()` {% since "1.4.0" /%}

`node:tls` gains per-context `secureContext.addCACert()` and process-wide `tls.setDefaultCACertificates()`. [#31155](https://github.com/oven-sh/bun/pull/31155)

#### `node:http2` `diagnostics_channel`, AltSvc, extended CONNECT, and `allowHTTP1` {% since "1.4.0" /%}

`node:http2` gains `diagnostics_channel` instrumentation, AltSvc and Origin frames, extended CONNECT, and `allowHTTP1` fallback for the compatibility server. [#31584](https://github.com/oven-sh/bun/pull/31584)

#### `fs.mkdtempDisposable()` and `FileHandle#pull()`/`#writer()` {% since "1.4.0" /%}

`fs.mkdtempDisposable()` and `FileHandle.prototype.pull()`/`.writer()` are implemented, and `fs.watch` no longer drops events when two files change in the same millisecond. [#31830](https://github.com/oven-sh/bun/pull/31830)

#### `node:zlib` brotli and zstd dictionaries {% since "1.4.0" /%}

`node:zlib` supports brotli and zstd dictionaries, `reset()` is Node-compatible, async `write()` accepts growable `SharedArrayBuffer`, and `zstdCompress` accepts explicit `undefined`/`null` options. Node's zlib suite passes at **96.8%**. [#34427](https://github.com/oven-sh/bun/pull/34427) [#36555](https://github.com/oven-sh/bun/pull/36555) [#36423](https://github.com/oven-sh/bun/pull/36423)

#### `node:util`: `styleText` hex colors, `getCallSites`, `tty.WriteStream` {% since "1.4.0" /%}

`styleText` hex colors, `getCallSites`, regexp highlighting, and `tty.WriteStream` are now implemented. `parseArgs` matches Node's property insertion order and treats `null` boolean flags as absent. `MIMEType` error messages match `ERR_INVALID_MIME_SYNTAX`. `types.isBigIntObject`/`isSymbolObject`/`isBoxedPrimitive` handle modified boxed primitives. [#34434](https://github.com/oven-sh/bun/pull/34434) [#34601](https://github.com/oven-sh/bun/pull/34601) [#33769](https://github.com/oven-sh/bun/pull/33769) [#34611](https://github.com/oven-sh/bun/pull/34611) [#34872](https://github.com/oven-sh/bun/pull/34872)

#### `v8.GCProfiler` {% since "1.4.0" /%}

`node:v8` adds `v8.GCProfiler` (backed by JavaScriptCore's `HeapObserver`) and `v8.isStringOneByteRepresentation()`.

#### ws-compatible `'upgrade'` and `'unexpected-response'` events {% since "1.4.0" /%}

Bun's `WebSocket` client emits `'upgrade'` and `'unexpected-response'` events, matching the ws package. [#36272](https://github.com/oven-sh/bun/pull/36272)

#### `dns.promises.getDefaultResultOrder()` and `getServers()` {% since "1.3.12" /%}

`node:dns/promises` now exports `getDefaultResultOrder()` and `getServers()`, fixing Vite 8 builds. [#28949](https://github.com/oven-sh/bun/pull/28949)

#### `SIGWINCH` on Windows {% since "1.3.3" /%}

On Windows, `SIGWINCH` now fires on terminal resize (unblocking TUI libraries like opentui and opencode), and `SIGHUP`/`SIGBREAK` fire on console close and Ctrl+Break. [#24704](https://github.com/oven-sh/bun/pull/24704)

#### `--use-system-ca` reads Node's Windows certificate stores {% since "1.3.14" /%}

`--use-system-ca` on Windows now reads the same certificate stores Node.js does (`ROOT`, `CA`, and `TrustedPeople` across local-machine, current-user, group-policy, and enterprise locations), fixing intranet servers that omit their intermediate chain. [#30408](https://github.com/oven-sh/bun/pull/30408)

### Package manager

#### Lockfile migration {% since "1.4.0" /%}

`bun install`'s npm `package-lock.json` migrator now supports lockfileVersion 1 through 4, including bundled and nested dependencies, `optionalPeers`, and `overrides`.

Migrating `pnpm-lock.yaml` v9 lockfiles now supports `patchedDependencies`, snapshot aliases, catalogs, git `path:`, multi-document files, `runtime:` entries, and named registries.

A project's `bunfig.toml` now takes precedence over any `.npmrc` for the same key; `.npmrc`-only settings such as `//host/:_authToken` still attach to registries declared in `bunfig.toml`.

#### `bun.lock` versioning {% since "1.3.2" /%}

`bun.lock` now records a `configVersion` alongside the existing `lockfileVersion`. So future Bun releases can change install defaults for new projects without affecting existing ones. New lockfiles get `configVersion: 1` and default to the isolated linker. Existing lockfiles without the field are treated as `configVersion: 0` and keep the hoisted default. [#24236](https://github.com/oven-sh/bun/pull/24236)

```json-diff
  {
+   "lockfileVersion": 2,
+   "configVersion": 1,
    "workspaces": {
```

#### `publicHoistPattern` and `hoistPattern` {% since "1.3.1" /%}

The isolated linker now reads `publicHoistPattern` and `hoistPattern` from `bunfig.toml` and `.npmrc`. `publicHoistPattern` hoists matching transitive packages (like `@types*` or `*eslint*`) to the root `node_modules` so every workspace can resolve them; `hoistPattern` controls what's hoisted into `node_modules/.bun/node_modules`. [#23567](https://github.com/oven-sh/bun/pull/23567)

```toml
[install]
publicHoistPattern = ["@types*", "*eslint*"]
hoistPattern = ["*"]
```

#### `install.hoist = false` {% since "1.4.0" /%}

`install.hoist = false` in `bunfig.toml` (or `hoist=false` in `.npmrc`) disables the isolated linker's hidden `node_modules/.bun/node_modules` fallback directory, so packages that `require()` an undeclared dependency fail with `MODULE_NOT_FOUND` instead of resolving through the fallback, matching pnpm's `hoist` setting. [#36972](https://github.com/oven-sh/bun/pull/36972)

#### `bun update --recursive` and `--filter` update every selected workspace {% since "1.4.0" /%}

`bun update --recursive` and `bun update --filter <pattern>` now update the dependencies of every workspace they select and write each workspace's `package.json`. `--filter` can be repeated, and `--filter '!name'` excludes a workspace. `bun outdated` accepts the same repeated `--filter`. Previously two filters selected nothing. A dependency declared as `catalog:` is left as written. [#36360](https://github.com/oven-sh/bun/pull/36360)

```sh
bun update --recursive --latest
bun update --filter 'pkg-*' --filter '!pkg-c'
```

#### `bun update <name>` updates every copy {% since "1.4.0" /%}

`bun update <name>` now re-resolves every copy of `<name>` in the lockfile, including the copies other workspaces and your transitive dependencies depend on. [#36360](https://github.com/oven-sh/bun/pull/36360)

#### Happy Eyeballs for registry connections {% since "1.4.0" /%}

`bun install` now correctly interleaves IPv6 and IPv4 addresses per RFC 8305 when connecting to the registry, so a blackholed IPv6 route (Starlink, some corporate networks, misconfigured Docker bridges) costs nothing per manifest fetch. [#36295](https://github.com/oven-sh/bun/pull/36295)

#### Streaming tarball extraction {% since "1.3.13" /%}

`bun install` now decompresses and extracts packages while they download, with incremental integrity hashing computed on the fly. [#29404](https://github.com/oven-sh/bun/pull/29404)

#### Peer dependency resolution is up to 8x faster {% since "1.3.13" /%}

`bun install --linker=isolated` is **up to 8x faster** on monorepos with heavy peer dependency graphs. The first resolution pass now deduplicates subtrees with the same resolved peer dependencies. Before, it expanded every position in the dependency tree. On one reported monorepo this cut the first-pass node count from millions to ~75K. The `.bun/` store layout is byte-identical. [#29342](https://github.com/oven-sh/bun/pull/29342)

#### `bun list` {% since "1.3.2" /%}

`bun list` is now a shorthand for `bun pm ls`, printing your dependency tree without the extra `pm` subcommand. [#24159](https://github.com/oven-sh/bun/pull/24159)

#### `bun publish` sends your README {% since "1.3.14" /%}

`bun publish` now sends `readme` and `readmeFilename` to the registry, so packages published with Bun show their README on npmjs.com. [#30257](https://github.com/oven-sh/bun/pull/30257)

#### Per-path `.npmrc` auth tokens {% since "1.3.11" improved="1.4.0" /%}

`.npmrc` auth tokens are now matched by host _and_ path, so multiple registries on the same host (Azure Artifacts, JFrog) each get their own token instead of last-one-wins. [#26351](https://github.com/oven-sh/bun/pull/26351)

#### `bun update` updates catalogs {% since "1.4.0" /%}

`bun update` now updates `catalog` version definitions in non-interactive mode, and re-resolves catalog references when run from the workspace root. [#36304](https://github.com/oven-sh/bun/pull/36304) [#36379](https://github.com/oven-sh/bun/pull/36379)

#### `patchedDependencies` cache keyed by full patch hash {% since "1.4.0" /%}

`patchedDependencies` cache entries are now keyed by a SHA-1 of the whole patch file. Previously the key was a Wyhash, and only the first 16 KiB of the file was hashed. So two projects sharing an install cache got each other's patched package if their patches collided or were identical for their first 16 KiB. Existing `node_modules` are re-patched once on the next install. [#32749](https://github.com/oven-sh/bun/pull/32749)

#### `bun pm ls --trusted` {% since "1.4.0" /%}

`bun pm ls --trusted` filters the dependency tree to packages allowed to run lifecycle scripts, honoring both `trustedDependencies` in `package.json` and Bun's default trusted list. Combines with `--all`. [#32478](https://github.com/oven-sh/bun/pull/32478)

### Other runtime fixes

- **`Bun.RedisClient`**: a failed connection closes its socket, `connect()` settles once, and `onclose` runs once. Before, a client that could not connect kept the process alive forever. Fixes [#18895](https://github.com/oven-sh/bun/issues/18895). [#39511](https://github.com/oven-sh/bun/pull/39511) [#39513](https://github.com/oven-sh/bun/pull/39513)
- **`Bun.RedisClient`**: `close()` and `connect()` cancel the pending retry timer, so a closed client no longer keeps the process alive. [#39546](https://github.com/oven-sh/bun/pull/39546)
- **`Bun.RedisClient`**: `idleTimeout` counts from connect and restarts on incoming data. Before, it behaved like `connectionTimeout`. [#38281](https://github.com/oven-sh/bun/pull/38281)
- **`Bun.RedisClient`**: `subscribe()` on a failed client rejects instead of storing the listener and keeping the process alive. [#39547](https://github.com/oven-sh/bun/pull/39547)
- **`Bun.RedisClient`**: `close()` on a `rediss://` client no longer hangs when the TLS shutdown is deferred by a stuck peer. [#39548](https://github.com/oven-sh/bun/pull/39548)
- **`Bun.RedisClient`**: `duplicate()` of a closed client starts with no close history and reconnects. [#39575](https://github.com/oven-sh/bun/pull/39575)
- `process.memoryUsage().heapUsed` now updates after every collection, including `Bun.gc(true)`. Before, it kept the value from the last allocation-driven collection. [#39593](https://github.com/oven-sh/bun/pull/39593)
- `console.write()` inside a `beforeExit` handler no longer loops forever when stdout is a pipe. [#38641](https://github.com/oven-sh/bun/pull/38641)
- Creating a `ShadowRealm` inside a `node:vm` context no longer crashes. [#39529](https://github.com/oven-sh/bun/pull/39529)
- `Bun.file(path).arrayBuffer()` on a file over 4 GiB throws `RangeError` instead of returning a truncated buffer. [#39558](https://github.com/oven-sh/bun/pull/39558)
- A source file of 2 GiB or more reports "File is too large to parse" instead of a garbled syntax error. [#39095](https://github.com/oven-sh/bun/pull/39095)
- ICU, libuv, and BoringSSL allocate through mimalloc. This fixes an ICU "failed to initialize Segments" error on Windows. [#39472](https://github.com/oven-sh/bun/pull/39472)
- `require("ws")` no longer loads `node:http` up front, which saves about 10 ms. [#39435](https://github.com/oven-sh/bun/pull/39435)
- `f64`/`double` arguments preserve `NaN`, `-0.0`, and negative BigInts exactly. [#33122](https://github.com/oven-sh/bun/pull/33122)
- `toBuffer` leaves caller-owned memory alone when no finalizer is provided. [#36521](https://github.com/oven-sh/bun/pull/36521)
- `JSVALUE_TO_INT32` handles double-encoded JSValues. [#34653](https://github.com/oven-sh/bun/pull/34653)
- `viewSource` and `JSCallback` throw validation errors. [#34396](https://github.com/oven-sh/bun/pull/34396)
- TinyCC updated to latest upstream (macOS 15 compatibility, arm64 alignment fixes). [#26210](https://github.com/oven-sh/bun/pull/26210)
- The built-in C compiler respects `C_INCLUDE_PATH` and `LIBRARY_PATH` (so NixOS works). [#26250](https://github.com/oven-sh/bun/pull/26250)
- `dlopen()` works on libraries embedded via `bun build --compile`. [#30720](https://github.com/oven-sh/bun/pull/30720)
- `new CString(ptr)` is constructable. [#25257](https://github.com/oven-sh/bun/pull/25257)
- Pointer values round-tripped through `Number(String(ptr))` no longer become `18446744073709551615` on the C side. [#25045](https://github.com/oven-sh/bun/pull/25045)
- `worker.terminate()` is safe while the worker thread is inside a `JSCallback`.
- `bun:ffi` error messages now include the actual `dlerror()` message from the OS, telling you exactly which library failed to load and why, instead of a generic "Failed to open library". [#23585](https://github.com/oven-sh/bun/pull/23585)
- **`Request.prototype.clone()` and `Response.prototype.clone()`** now throw `TypeError` when the body has already been consumed or is locked, per the Fetch spec. Previously the clone succeeded silently and resolved to an empty body. [#33129](https://github.com/oven-sh/bun/pull/33129)
- **`Response.redirect(url)`** now runs its argument through the WHATWG URL parser before writing the `Location` header, so spaces, non-ASCII characters, default ports, and dot segments are normalized per the Fetch spec. [#33126](https://github.com/oven-sh/bun/pull/33126)
- **`Bun.readableStreamToArrayBuffer`** and the other `readableStreamTo*` helpers now return a rejected promise instead of throwing synchronously when passed an already-errored stream; the same applies to `new Response(erroredStream).arrayBuffer()`. [#33043](https://github.com/oven-sh/bun/pull/33043)
- **`HTMLRewriter.transform()`** now rejects when the upstream response body errors mid-stream instead of resolving with a silently truncated document. [#32927](https://github.com/oven-sh/bun/pull/32927)
- **`structuredClone` on a detached `ArrayBuffer`** now throws a `DataCloneError` `DOMException` instead of a plain `TypeError`, matching the HTML spec and Node.js. [#32799](https://github.com/oven-sh/bun/pull/32799)
- **`structuredClone(Object.prototype)`** now returns `{}` instead of throwing `DataCloneError`, matching Node.js and the HTML spec. [#32983](https://github.com/oven-sh/bun/pull/32983)
- **`FormData` multipart serialization** normalizes lone CR and lone LF to CRLF in field names and string values per the WHATWG spec, so serialized bodies are byte-identical to Node.js and browsers. [#32975](https://github.com/oven-sh/bun/pull/32975)
- **`URLSearchParams` and `FormData`** `.get()`, `.getAll()`, and `.has()` now normalize malformed Unicode in the name argument the same way `.set()` and `.append()` do, so an entry stored under such a name is found by lookup, matching Node.js and browsers. [#33398](https://github.com/oven-sh/bun/pull/33398)
- **`console.table()` and `Bun.inspect.table()`** now invoke each cell's getter and custom-inspect hook exactly once instead of two or three times. [#32924](https://github.com/oven-sh/bun/pull/32924)
- **`socket.setTypeOfService()`** on `Bun.connect` sockets validates its argument, throwing `ERR_INVALID_ARG_TYPE`/`ERR_OUT_OF_RANGE` for non-numeric values.
- **`FormData` multipart boundaries** now exactly match WebKit's `----WebKitFormBoundary…` format, fixing uploads to strict multipart parsers including OpenAI's file upload endpoint. [#29631](https://github.com/oven-sh/bun/pull/29631)
- **`TextDecoder` with `{ stream: true }`** no longer corrupts characters split across chunk boundaries for `shift_jis`, `euc-jp`, `iso-2022-jp`, `gbk`, `gb18030`, `big5`, and `euc-kr`. [#31438](https://github.com/oven-sh/bun/pull/31438)
- **`TextEncoder.encodeInto()`** now returns `{ read: 0, written: 0 }` and leaves the buffer untouched when a 4-byte character (like an emoji) doesn't fit, instead of writing the � replacement character, matching the WHATWG Encoding spec. [#31532](https://github.com/oven-sh/bun/pull/31532)
- **`self.postMessage(msg, [transferable])`** inside a `Worker` now actually transfers `ArrayBuffer`s and `MessagePort`s. Previously the positional-array overload was silently ignored and transferables were cloned instead of moved. [#30068](https://github.com/oven-sh/bun/pull/30068)
- **`new Request()`** now stores and returns the `cache` and `mode` options instead of always reporting `"default"` and `"navigate"`, and preserves them through `.clone()`. [#26099](https://github.com/oven-sh/bun/pull/26099)
- **Sliced `Blob`s** respect their slice bounds when streamed or used as a `Response` body, and advertise the correct `Content-Length`.
- **`Response.clone()` and `Request.clone()`** now tee the body when `.body` was accessed (but not read) before cloning. Previously the original's cached `.body` stream was silently drained to zero bytes, breaking the common `res.clone()`-then-`new Response(res.body, res)` cache-and-forward pattern. [#33779](https://github.com/oven-sh/bun/pull/33779)
- **`new TextDecoder()` and `.decode()`** now throw `TypeError` when passed a primitive as the options argument and accept `null` as the default dictionary, per WebIDL. [#35189](https://github.com/oven-sh/bun/pull/35189)
- **`new File()`** now normalizes the `lastModified` option per WebIDL: `NaN` and unparseable strings become `0`, and `null` is treated as present (yielding `0`) instead of falling through to `Date.now()`. [#33922](https://github.com/oven-sh/bun/pull/33922)
- **`.env` parsing** handles UTF-8 correctly. A leading BOM no longer drops the first variable. Applies to auto-loaded `.env` files, `--env-file`, and `util.parseEnv`. [#34002](https://github.com/oven-sh/bun/pull/34002)
- **`.env` parsing**: Trailing junk after a closing quote no longer swallows the following lines into the value. Applies to auto-loaded `.env` files, `--env-file`, and `util.parseEnv`. [#34003](https://github.com/oven-sh/bun/pull/34003)
- **`.env` parsing**: Multibyte characters whose encoding ends in `0xA0` are no longer corrupted by whitespace trimming. Applies to auto-loaded `.env` files, `--env-file`, and `util.parseEnv`. [#34001](https://github.com/oven-sh/bun/pull/34001)
- **Assigning to an ES module import** is now a runtime `TypeError` when the write is reached, per ECMA-262, instead of a parse-time error that made the module unloadable even when the assignment was in dead code or a `try`/`catch`. `bun build` still errors at bundle time. [#36046](https://github.com/oven-sh/bun/pull/36046)
- **`require.extensions` hooks** registered by an entry point of 4 KiB or more now work on every run. Previously they were ignored from the second run onwards, once the file came from the transpiler cache, and files with unknown extensions imported by that entry point were parsed as TSX instead of resolving to their paths.
- **`require.extensions` hooks** Entry points built with `bun build --target=bun --format=cjs` had the same `require.extensions` bug on every run. [#33371](https://github.com/oven-sh/bun/pull/33371)
- `structuredClone` (and `postMessage`, `Worker`, `MessageChannel`) no longer silently resolves back-references to the wrong value when the graph contains a `BigInt`, `CryptoKey`, or `X509Certificate`. Previously a shared object appearing after a BigInt could come back as the BigInt itself, or deserialization could fail entirely. [#32791](https://github.com/oven-sh/bun/pull/32791)
- `db.close(true)` finalizes all outstanding prepared statements. [#36573](https://github.com/oven-sh/bun/pull/36573) [#36793](https://github.com/oven-sh/bun/pull/36793) [#37045](https://github.com/oven-sh/bun/pull/37045) [#34925](https://github.com/oven-sh/bun/pull/34925) [#34186](https://github.com/oven-sh/bun/pull/34186) [#34962](https://github.com/oven-sh/bun/pull/34962)
- **`Bun.RedisClient`**: `expire()` rejects `NaN`/`undefined` seconds instead of silently sending `EXPIRE key 0`
- **`Bun.RedisClient`**: the RESP line-length cap is raised from 512 KB to 512 MB for large replies
- **`Bun.RedisClient`**: a torn `VerbatimString`/`BlobError` body is no longer treated as a fatal protocol error
- **`Bun.RedisClient`**: invalid database segments in the connection URL are rejected instead of silently ignored
- S3 simple requests handle close-delimited HTTP responses.
- **`Bun.write()`**: no longer over-copies or truncates when passed a caller-owned destination file descriptor. [#36758](https://github.com/oven-sh/bun/pull/36758)
- **`Bun.write()`**: `Bun.write(file, file)` no longer truncates on Linux when the source size is unknown (`splice`/`sendfile` loop to EOF). [#36590](https://github.com/oven-sh/bun/pull/36590)
- **`Bun.YAML`**: input is validated for embedded NUL bytes before parsing.
- **`Bun.randomUUIDv7()`**: an explicit timestamp argument is honored verbatim. [#34321](https://github.com/oven-sh/bun/pull/34321)
- **`Bun.randomUUIDv7()`**: monotonicity is preserved when the 12-bit counter rolls over within a millisecond. [#34022](https://github.com/oven-sh/bun/pull/34022)
- **`Bun.randomUUIDv7()`**: timestamps ≥ 2^48 and `NaN` are rejected instead of silently truncated. [#34021](https://github.com/oven-sh/bun/pull/34021)
- `gzipSync`/`deflateSync` throw a clear invalid-argument error for out-of-range libdeflate compression levels instead of a misleading "Out of memory". [#34117](https://github.com/oven-sh/bun/pull/34117) [#34114](https://github.com/oven-sh/bun/pull/34114)
- **`Bun.mmap()`** returns a view at the requested `offset` instead of the page-aligned offset. [#34120](https://github.com/oven-sh/bun/pull/34120)
- **`Bun.mmap()`**: its `offset`/`size` options are now typed. [#34573](https://github.com/oven-sh/bun/pull/34573)
- **`Bun.udpSocket`**: `connect()` rejects out-of-range ports instead of silently clamping to 0. [#34029](https://github.com/oven-sh/bun/pull/34029)
- **`Bun.udpSocket`**: numeric options are range-checked instead of silently truncated (also applies to `Bun.password`). [#36999](https://github.com/oven-sh/bun/pull/36999)
- **`Bun.FileSystemRouter`**: `match()` returns `null` for paths not starting with `/` instead of matching incorrectly. [#34028](https://github.com/oven-sh/bun/pull/34028)
- **`Bun.FileSystemRouter`**: empty-key query pairs are skipped instead of terminating the query parse early. [#34027](https://github.com/oven-sh/bun/pull/34027)
- **`Bun.color()`** clamps out-of-range object alpha instead of wrapping mod 256. [#34020](https://github.com/oven-sh/bun/pull/34020)
- **`Bun.color()`** lists all accepted format strings in its invalid-format error. [#34314](https://github.com/oven-sh/bun/pull/34314)
- **`Bun.CryptoHasher.update()`** rejects odd-length hex strings instead of silently truncating. [#35188](https://github.com/oven-sh/bun/pull/35188)
- **`Bun.Socket.setKeepAlive()`** honors milliseconds as documented. [#34269](https://github.com/oven-sh/bun/pull/34269)
- **`Bun.Socket.setKeepAlive()`**: `setKeepAlive(true)` returns `true`. [#34269](https://github.com/oven-sh/bun/pull/34269)
- **`Bun.Glob`** preserves a leading `**` as a globstar under `!` negation. [#33759](https://github.com/oven-sh/bun/pull/33759)
- **`Bun.Transpiler`** throws `TypeError` for non-transpilable loaders.
- **`Bun.openInEditor()`** throws when no editor is found instead of silently spawning an empty command. [#37210](https://github.com/oven-sh/bun/pull/37210)
- **`Bun.RedisClient`**: calling `.connect()` after a disconnect properly resets the failed state instead of permanently rejecting every command with `Connection has failed`. [#29927](https://github.com/oven-sh/bun/pull/29927)
- **`Bun.file()`**: `.stat()` and `.delete()` no longer corrupt paths containing non-ASCII UTF-8 characters. [#26646](https://github.com/oven-sh/bun/pull/26646)
- **`Bun.generateHeapSnapshot("v8", "arraybuffer")`** returns the snapshot as a UTF-8 `ArrayBuffer`, which scales to very large heaps.
- Runtime `Bun.plugin()` `onResolve` hooks that return a filesystem path in the default `file` namespace now work. Previously the path came back as `file:/abs/path.js` and failed to load, breaking path aliases and virtual-to-real redirects for dynamic `import()`, computed `require()`, `Bun.resolveSync()`, and `import.meta.resolve()`. [#33409](https://github.com/oven-sh/bun/pull/33409)
- **`Bun.TOML.parse()`** throws on syntax errors like missing array commas instead of silently returning partial data. [#31255](https://github.com/oven-sh/bun/pull/31255)
- **`Bun.TOML.stringify()`** no longer emits redundant headers for pass-through super-tables. [#37009](https://github.com/oven-sh/bun/pull/37009)
- Added a socket syscall fault-injection layer for deterministic fuzzing of `node:net`, `node:tls`, `node:http`, HTTP/2, `fetch`, and WebSocket against partial reads/writes, mid-stream `ECONNRESET`/`EPIPE`, `EAGAIN` storms, and backpressure races, and fixed several bugs it surfaced.
- Crashes in `Worker` and `worker_threads` termination have been fixed.
- A crash in `Bun.FileSystemRouter.match()` has been fixed.
- A rare crash in `console.log` and `Bun.inspect` formatting has been fixed.
- A crash in `structuredClone()` and `postMessage()` serialization has been fixed.
- A crash in proxied `fetch()` requests has been fixed.
- Fixed two GC bugs where an `AbortSignal` could lose its `reason` or its `abort` event listeners.
- `AbortSignal.any()` keeps its source signals correctly rooted for GC.
- `Error` finalization crash is fixed.
- Stream error handling crash is fixed.
- Fixed a top-level await bug where a dynamic `import()` from a module that was itself still awaiting would throw `ReferenceError: Cannot access '...' before initialization` instead of resolving.
- `Worker` termination is safe while `fs.watchFile()` callbacks are pending.
- `fs.readFile(path, "utf8")`, `Buffer.toString("utf8")`, and `StringDecoder` report allocation failure as an `OutOfMemory` error.
- Whole-file reads (the `.env` loader, `bun pm pack`, `Bun.Image`) report allocation failure as `ENOMEM`.
- `Bun.FileSystemRouter.reload()` synchronizes access to the resolver's cached directory-entry map.
- Fixed a segfault running the linux-arm64 build under Termux on Android by issuing `epoll_pwait2` as a raw syscall and gating it off on Android, whose per-app seccomp policy blocks it.
- A crash in auto-install resolution has been fixed.
- `require("./addon.node?v=1")` loads the addon and `import("./addon.node?v=1")` throws the intended `TypeError`; query strings and custom extensions mapped to the napi loader are handled.
- The ini parser treats empty single-quoted values (`key='` or `key=''`) as empty strings, matching npm/ini.
- `console.write.call(primitive)` throws `ERR_INVALID_THIS`.
- Crash reports from baseline x86_64 builds now symbolicate correctly on bun.report; a dead `cfg(feature)` gate was tagging them with the non-baseline platform and resolving against the wrong debug artifact.
- Batched UDP receive (`recvmsg_x`/`sendmsg_x`) is gated to macOS 15.6+.
- The `bun` npm package's postinstall now tries the musl binary first on musl-based Linux (detected via `process.report`, not just Alpine). [#36283](https://github.com/oven-sh/bun/pull/36283)
- The generated `@oven/bun-linux-*` packages now carry a `libc` field so npm skips downloading the wrong-ABI optional dependency. [#36283](https://github.com/oven-sh/bun/pull/36283)
- `bun --print` with top-level `await` now prints the module's final completion value instead of the first awaited value: `bun -p '(await 1) + 1'` prints `2`, not `1`. [#30208](https://github.com/oven-sh/bun/pull/30208)
- The debugger no longer pegs a CPU core at 100% while paused at a breakpoint; Bun now sleeps instead of spinning in a loop while you step through code. [#29438](https://github.com/oven-sh/bun/pull/29438)
- Breakpoints in files over 50KB now land on the right line when debugging from VS Code's debug terminal. The runtime transpiler cache is disabled whenever the inspector is active via `BUN_INSPECT`, not just `--inspect`. [#28189](https://github.com/oven-sh/bun/pull/28189)
- Loading a native addon known to require V8 C++ APIs Bun doesn't yet support (currently `better-sqlite3`) now throws a clear error linking to the tracking issue and suggesting `bun:sqlite`, instead of a confusing `dlopen` failure. [#24384](https://github.com/oven-sh/bun/pull/24384)
- Running `bun file.css` (or any file type Bun can't execute directly) now prints "Cannot run css files directly" instead of the misleading "File not found". [#26126](https://github.com/oven-sh/bun/pull/26126)
- When the `bun` npm package is installed with `--ignore-scripts` (or via pnpm, which skips postinstall by default), the placeholder binaries now print a clear error explaining how to fix it and exit non-zero, instead of silently doing nothing. [#26259](https://github.com/oven-sh/bun/pull/26259)
- Fixed a `--hot` race where an error thrown during module evaluation could be remapped against the wrong sourcemap if a file-watcher event fired before the error was printed. [#29740](https://github.com/oven-sh/bun/pull/29740)
- `@types/bun` no longer depends on `@types/react`, so projects that don't use React no longer get React's global JSX types pulled in just by installing Bun's types. [#24557](https://github.com/oven-sh/bun/pull/24557)
- `@types/bun` now ships against `@types/node@25`. [#25460](https://github.com/oven-sh/bun/pull/25460)
- The `expect().toContainKey*` matchers fall back to `PropertyKey` when `keyof unknown` resolves to `never`. [#25460](https://github.com/oven-sh/bun/pull/25460)
- Bun's repo now ships a Nix flake, so contributors on NixOS can spin up a fully reproducible dev environment with LLVM 19, CMake, Rust, and Go with no `sudo` required. [#23406](https://github.com/oven-sh/bun/pull/23406)
- Download progress (like `bun upgrade`) now shows human-readable sizes (`23.2MiB/100MiB`) instead of raw byte counts. [#24266](https://github.com/oven-sh/bun/pull/24266)
- CI environment detection now recognizes 40+ providers (auto-generated from the `ci-info` dataset). [#23708](https://github.com/oven-sh/bun/pull/23708)
- CI environment detection respects `CI=true` to force CI mode. [#23708](https://github.com/oven-sh/bun/pull/23708)
- `--no-clear-screen` and `BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD` are now honored by the dev server when `hmr: true`. [#26184](https://github.com/oven-sh/bun/pull/26184)
- `bun init --minimal` no longer creates Cursor rules or `CLAUDE.md`; it now writes only `package.json` and `tsconfig.json`, as intended. [#26051](https://github.com/oven-sh/bun/pull/26051)
- `bun init --react` templates now name the server entrypoint `index.ts` instead of `index.tsx`. [#23469](https://github.com/oven-sh/bun/pull/23469)
- The react-tailwind template's `build.ts` now type-checks under its own strict `tsconfig.json`. [#26258](https://github.com/oven-sh/bun/pull/26258)
- `bun publish --help` now shows the correct description for `--dry-run`. [#25137](https://github.com/oven-sh/bun/pull/25137)
- The VS Code extension's test explorer now recognizes Bun's newer test functions during static analysis, so code lenses and the sidebar pick them up. [#25256](https://github.com/oven-sh/bun/pull/25256)
- Debugger CLI flags now propagate correctly to single-file executables built with `bun build --compile`. [#25600](https://github.com/oven-sh/bun/pull/25600)
- Error carets for out-of-range `\u{...}` Unicode escapes now point exactly at the backslash instead of two columns to the left. [#31138](https://github.com/oven-sh/bun/pull/31138)
- The dev server's inspector no longer emits duplicate `BunFrontendDevServer.clientNavigated` events on route navigation. [#32081](https://github.com/oven-sh/bun/pull/32081)
- Type-definition fixes in `@types/bun`: added `Server.protocol`, `S3Options.contentEncoding`, the `seed` parameter on `Bun.hash.crc32()`, UDP socket methods, `autoloadTsconfig` / `autoloadPackageJson`, and `BunLockFile.configVersion` documentation.
- `Socket.reload()` correctly requires `{ socket: handler }`
- `Bun.build()` allows `splitting: true` alongside `compile`
- The `Bun.Build` `target` type includes `bun-linux-x64-baseline`, `bun-linux-x64-modern`, and other SIMD variants.
- The FFI type maps no longer trigger `TS2300: Duplicate identifier` under the `tsgo` native preview.. [#25267](https://github.com/oven-sh/bun/pull/25267)

### Other test runner fixes

- Large `expect()` mismatches print a real diff. The old diff engine gave up after 1 s and printed both values whole; a 456 KB string pair now diffs in 4 ms instead of 74 ms. [#39310](https://github.com/oven-sh/bun/pull/39310)
- Fixed the TypeScript types for `vi.mock` in `bun:test`. It was incorrectly typed as `vi.module`, causing "Property 'mock' does not exist" errors in editors. [#24248](https://github.com/oven-sh/bun/pull/24248)
- The JUnit reporter now emits one `<testcase>` per retry attempt, so CI flaky-test dashboards get per-attempt timing. [#26866](https://github.com/oven-sh/bun/pull/26866)
- `bun test --bail` now flushes the JUnit `--reporter-outfile` on both bail paths (test failure and unhandled rejection), so CI always gets the XML even when bail triggers early. [#26852](https://github.com/oven-sh/bun/pull/26852)
- `toMatchSnapshot()` now works correctly with `--rerun-each` and test retries: the snapshot counter is reset between iterations instead of looking for `<name> 2`, `<name> 3`, etc. [#29375](https://github.com/oven-sh/bun/pull/29375)
- Snapshot-creation errors in CI now include the snapshot name and the received value, so you can find which assertion tried to write a new snapshot. [#23419](https://github.com/oven-sh/bun/pull/23419)
- Object diffs in `expect()` failures and `console.log` no longer silently drop properties with empty-string keys. `{ "": "value" }` previously printed as `{}`. [#27166](https://github.com/oven-sh/bun/pull/27166)
- IDE test integrations now receive `TestReporter.found`/`start`/`end` events even when the debugger attaches after tests were discovered (e.g. with `--inspect` instead of `--inspect-wait`). [#25986](https://github.com/oven-sh/bun/pull/25986)
- `test.each()` / `describe.each()` keep the table array alive until the test is registered.
- `jest.mock()` validates its source origin.
- `expect.extend()` validates that each matcher is an ordinary JavaScript function and throws a `TypeError` otherwise.
- `expect.extend()` handles matcher objects with numeric index keys.
- Custom matchers registered via `expect.extend()` throw `TypeError: not a constructor` when called with `new`.
- Exceptions thrown inside custom asymmetric matchers registered via `expect.extend` now propagate to JavaScript instead of triggering a debug assertion. [#29199](https://github.com/oven-sh/bun/pull/29199)
- `spyOn()` supports indexed property keys.
- `mock.module()` validates that its first argument is a string.
- `mock.module(specifier)` / `vi.mock(specifier)` work without a factory callback when auto-install is triggered.
- `bun test` formats deeply nested objects safely.
- Negated `concurrentTestGlob` patterns like `"!**/sequential-*.test.ts"` now correctly select non-matching files for concurrent execution. [#35315](https://github.com/oven-sh/bun/pull/35315)
- `bun test` no longer parks in the event loop for ~100ms per file when a previous file left a long-running timer pending; in a debug build, a 21-file suite with a leaked `setTimeout` went from 2.5s to 0.6s. [#36453](https://github.com/oven-sh/bun/pull/36453)
- `Bun.deepEquals()` and `expect().toEqual()` now compare `Temporal` objects (`Instant`, `PlainDate`, `ZonedDateTime`, `Duration`, …) by value; previously any two instances of the same class were reported equal. [#37024](https://github.com/oven-sh/bun/pull/37024)
- `--reporter=junit` now emits well-formed XML: control characters in test names are dropped instead of producing invalid entities, `classname` is no longer double-escaped, and `<failure>` elements include the error message. [#34975](https://github.com/oven-sh/bun/pull/34975)
- `--reporter=junit` now emits one `<testcase>` per test with its final outcome after retries, so CI dashboards no longer show a passing suite as failed because of intermediate retry attempts. [#33967](https://github.com/oven-sh/bun/pull/33967)
- Fixed inspector `TestReporter` test IDs colliding between the live and retroactive reporting paths, which caused inspector clients keying state by ID to conflate unrelated tests. [#36522](https://github.com/oven-sh/bun/pull/36522)
- `expect()` failure messages no longer swallow `<...>` spans in Received/Expected values; comparing `'<div class="a">Hello</div>'` against `'<div class="b">Hello</div>'` previously printed both as `"Hello"`. [#34343](https://github.com/oven-sh/bun/pull/34343)
- `toHaveReturned()` and related matchers validate a mock's `.mock.results` array before reading it.
- `spyOn()` supports spying on a function's `prototype` property.
- Formatting a `FormData` value validates its `toJSON` property.
- `test.each()` handles values that throw while being formatted into the test title.
- `toBeArrayOfSize()` and `toHaveBeenCalledTimes()` handle arrays of any length.

### Other bundler fixes

- `Bun.build()` waits only for its own work. A pending `fs.readFile()` on a FIFO no longer blocks an unrelated build. [#38604](https://github.com/oven-sh/bun/pull/38604)
- `--splitting` no longer emits a chunk for an `import()` that is only reachable from dead code, such as an `if (FLAG)` removed by `--define`. [#39591](https://github.com/oven-sh/bun/pull/39591)
- In a `--compile` executable, `require()` of another embedded CommonJS entry point works instead of failing with "Failed to evaluate module". [#38437](https://github.com/oven-sh/bun/pull/38437)
- `Bun.build({ compile: true })` now applies sourcemaps correctly, so stack traces from compiled binaries show your real source paths instead of `/$bunfs/root/app.js`. [#23916](https://github.com/oven-sh/bun/pull/23916)
- Fixed `unicode-range` in `@font-face` being mangled by the CSS parser (`U+0000-00FF` → `U0-0FF`), which caused browsers to drop the font. [#27613](https://github.com/oven-sh/bun/pull/27613)
- Fixed `import.meta.url` in bundles built with `--bytecode`. [#23803](https://github.com/oven-sh/bun/pull/23803)
- Fixed `__toESM` emission when bundling ESM input to CJS output; the default-export wrapper now matches Node.js semantics. [#23803](https://github.com/oven-sh/bun/pull/23803)
- Fixed `bun build --compile` silently producing a no-op executable when 8 or more files were embedded. A chunk-sorting bug was picking an asset wrapper as the entry point instead of your code. [#25859](https://github.com/oven-sh/bun/pull/25859)
- Fixed `bun build --compile` producing an all-zeros binary when the output directory lives on a different filesystem than the temp directory (common in Docker, Gitea runners, and other overlayfs setups). [#26883](https://github.com/oven-sh/bun/pull/26883)
- **Standalone executables** built with `bun build --compile` now apply `BUN_OPTIONS` as `execArgv` instead of leaking it into `process.argv`. [#26346](https://github.com/oven-sh/bun/pull/26346)
- **CSS parser** now accepts class selectors in `::view-transition-old(.foo)`, the `.` null-cell token in `grid-template-areas`, `@page :left` / `@page foo:first` pseudos, and `mask` shorthand `geometry-box` values.
- **CSS parser**: Logical `border-*-*-radius` properties (including with `var()`) are no longer dropped or mismapped.
- **CSS `@layer`**: top-level `@layer` ordering declarations are preserved (fixes Tailwind CSS).
- **CSS `@layer`**: `light-dark()` fallback variables are now injected inside `@layer` blocks.
- **CSS minifier** bounds nested `&` expansion, `light-dark()` evaluation, angle values, and pseudo/at-rule nesting.
- **CSS minifier** merges adjacent rules with identical selectors in linear time.
- **JS minifier** now collapses `(a) => { return x }` into `(a) => x`.
- **JS minifier**: a batch of invalid-output edge cases are fixed: `xinstanceof y` token fusion at start-of-file, dangling `{ ...a, x: }` from simplified spreads, `Promise.resolve().then(() => )` from unused dynamic imports, empty `else {}` blocks, and numeric property keys that overflow to `Infinity`.
- **Tree-shaking** correctly handles `sideEffects: false` barrels that re-export namespace imports (`import * as ns; export { ns }`), object literals keyed by inlined enum members, and `export *` across package boundaries, fixing `undefined` exports from packages like `@tanstack/react-query`. [#27524](https://github.com/oven-sh/bun/pull/27524)
- **HTML bundling** Multiple HTML entrypoints sharing one CSS file all get the `<link>` tag.
- **HTML bundling** Compiled HTML references chunks with root-relative paths so assets load from any route.
- **HTML bundling** `--compile --target=browser` now emits sourcemaps for inlined scripts. [#27821](https://github.com/oven-sh/bun/pull/27821)
- **HTML bundling** `--compile --target=browser` correctly inlines JS-imported assets as `data:` URIs. [#27821](https://github.com/oven-sh/bun/pull/27821)
- **Dev server & HMR**: rapid successive saves no longer throw "Unknown HMR script".
- **Dev server & HMR**: multiple `import {}` statements from the same barrel no longer fail with "X is not a function".
- **Dev server & HMR**: CSS rebuilds and file-watching are hardened.
- **Sourcemaps**: `--compile --sourcemap=external` now writes `.map` files to disk (one per chunk with `--splitting`). [#27396](https://github.com/oven-sh/bun/pull/27396)
- **Sourcemaps**: comment statements now emit mappings for better debugger accuracy. [#27396](https://github.com/oven-sh/bun/pull/27396)
- **Sourcemaps**: a memory leak in `Bun.build()` with `sourcemap: 'inline'` and no `outdir` is fixed. [#27396](https://github.com/oven-sh/bun/pull/27396)
- **Symbol renaming**: a named function expression that shadowed an inlined import is now correctly renamed, fixing infinite recursion at runtime in Svelte 5 dev-mode apps. [#26027](https://github.com/oven-sh/bun/pull/26027)
- **Dynamic `import()`** with `{ with: { type: 'text' } }` now applies the requested loader during bundling. [#28045](https://github.com/oven-sh/bun/pull/28045)
- **Dynamic `import()`**: CommonJS chunks from dynamic imports are correctly wrapped with `__toESM` when code splitting is enabled. [#26120](https://github.com/oven-sh/bun/pull/26120)
- **Transpiler correctness**: we fixed dozens of fuzzer-found invalid-output cases and hardened the parser. This includes:
  - `using` declarations inside `switch` cases
  - decorators on dropped TypeScript members
  - anonymous decorated `export default class`
  - deeply nested types and block statements (now throw a clean error)
  - `infer ... extends` parsing
  - `for (async of …)`
  - reserved-word inferred names
  - namespace/enum scope handling
  - malformed `declare` blocks
- Fixed `bun build --compile` producing segfaulting Linux binaries when the base `bun` had been run through `patchelf` (as NixOS's `autoPatchelfHook` does): the writable `PT_LOAD` segment to extend is now selected by vaddr containment of the `.bun` section, not table order.
- Fixed `bun build --compile` mangling `..` segments in embedded entrypoint paths to `_.._`, breaking `new Worker()` targets that lived above the compile root. [#32730](https://github.com/oven-sh/bun/pull/32730)
- Fixed non-deterministic output and silently dropped modules when code-splitting through chained `sideEffects: false` barrel packages (`@sentry/node-core` re-exporting `@sentry/core`), which surfaced at runtime as `Exported binding 'X' needs to refer to a top-level declared variable`. [#36838](https://github.com/oven-sh/bun/pull/36838)
- Fixed HTML entry points writing a shared chunk into `<script src>` instead of the entry chunk when code splitting was enabled, leaving the page blank with no error. [#34113](https://github.com/oven-sh/bun/pull/34113)
- An unresolvable `require()` inside a `catch` block now emits a runtime throw instead of failing the build, matching the existing handling for `try` bodies (fixes bundling packages that probe optional dependencies with try/catch fallbacks). [#35659](https://github.com/oven-sh/bun/pull/35659)
- **JS minifier** `[x][0]` / `{f:x}.f` folding no longer breaks optional-chain, `this`-binding, or assignment-target semantics. [#36730](https://github.com/oven-sh/bun/pull/36730)
- **JS minifier** `delete` on constant-folded import identifiers no longer emits invalid output. [#36740](https://github.com/oven-sh/bun/pull/36740)
- **JS minifier** `!`/`typeof` folding on array/object/class literals keeps their side effects. [#34254](https://github.com/oven-sh/bun/pull/34254)
- **JS minifier** Non-decimal BigInt literals (`0xffn`, `0o7n`, `0b1n`) are no longer constant-folded using their raw source text. [#34823](https://github.com/oven-sh/bun/pull/34823)
- **JS minifier** Non-ASCII Unicode identifiers survive the bundler's renaming. [#33863](https://github.com/oven-sh/bun/pull/33863)
- **JS minifier** Bare `$` is never picked as a minified name to avoid colliding with jQuery-style globals. [#35668](https://github.com/oven-sh/bun/pull/35668)
- Unused classes containing private fields/methods are now dropped. [#36528](https://github.com/oven-sh/bun/pull/36528) [#35472](https://github.com/oven-sh/bun/pull/35472) [#35957](https://github.com/oven-sh/bun/pull/35957)
- Classes with side-effectful computed keys are no longer incorrectly tree-shaken. [#36528](https://github.com/oven-sh/bun/pull/36528) [#35472](https://github.com/oven-sh/bun/pull/35472) [#35957](https://github.com/oven-sh/bun/pull/35957)
- **TypeScript parser** ASI applies after contextual keywords before a newline. [#34258](https://github.com/oven-sh/bun/pull/34258)
- **TypeScript parser** Block-scoped `enum` lowers with `let` instead of `var` [#34249](https://github.com/oven-sh/bun/pull/34249)
- **TypeScript parser** `enum`/`namespace` bodies reject stray `yield`/`await`/`this`/`return` [#34250](https://github.com/oven-sh/bun/pull/34250)
- **TypeScript parser** Optional tuple labels that are type-position keywords parse. [#34248](https://github.com/oven-sh/bun/pull/34248)
- **TypeScript parser** `async as T` / `async satisfies T` parse as casts, not arrow functions. [#34246](https://github.com/oven-sh/bun/pull/34246)
- **TypeScript parser** Standard decorator grammar accepts `!`, `#private`, and `export @dec` forms. [#34245](https://github.com/oven-sh/bun/pull/34245)
- **TypeScript parser** Type-argument lists in expression position require a bare `>` to close. [#34224](https://github.com/oven-sh/bun/pull/34224)
- **Printer & lexer**: `export {}` is no longer emitted inside unbraced `if`/`while`/`do` bodies (a syntax error).
- **Printer & lexer**: the JSON printer emits valid escapes for the BEL and VT control characters (`U+0007`, `U+000B`).
- **Printer & lexer**: overflowing or unterminated `\u{…}` escapes are rejected at parse time.
- `@supports` conditions containing newlines keep correct sourcemap line/column tracking.
- url() `#fragment` suffixes (and `?query` on the file-loader path) survive asset rewriting.
- color-mix() rejects out-of-range percentages.
- The CSS tokenizer handles non-UTF-8 bytes.
- Minified token lists keep adjacent '/' and '\*' delims separated.
- Fixed sourcemap column drift and unsorted `mappings` segments on generated lines crossing two or more placeholder substitutions (multiple file-loader imports, or an entry chunk importing from multiple shared chunks). [#33860](https://github.com/oven-sh/bun/pull/33860)
- **Build pipeline**: `onBeforeParse` plugin externals are GC-rooted for the lifetime of the build.
- **Build pipeline**: `--no-macros` propagates to every parse task.
- **Build pipeline**: an unterminated `[placeholder` in `--entry-naming`/`--chunk-naming` reports an error.
- **Build pipeline**: a module that fails to print now fails the build instead of emitting truncated output.
- `bun build --compile --target=bun-darwin-*` validates that `--compile-executable-path` points at a well-formed Mach-O binary and exits 1 with `InvalidObject` otherwise, as malformed ELF and PE bases already did with `InvalidElfFile` and `InvalidPEFile`.
- Fixed `--compile --bytecode --format=esm --splitting` builds in which an import from another chunk resolved to a Node builtin instead of the chunk's export. It happened when a `require()`d file in that chunk had a tree-shaken import with the same name as the export (`import { rm } from "fs/promises"`). Minified builds hit this whenever the minifier reused such a name. [#37619](https://github.com/oven-sh/bun/pull/37619)
- Fixed `--compile --bytecode --format=esm` binaries breaking on imports and re-exports of modules left outside the bundle. Examples: `export * as ns from "node:fs"` threw `Cannot access 'ns' before initialization`; `export { readFileSync as rfs } from "node:fs"` left `rfs` as `undefined`; `import { join } from "node:path"` in a file that also assigns `module.exports` gave `join is not defined`. These builds now behave the same as without `--bytecode`. [#37677](https://github.com/oven-sh/bun/pull/37677)
- `--public-path` was composing with the importer-relative chunk path instead of the outdir-relative one, so any chunk in a subdirectory emitted a URL like `https://cdn.example/app/../../chunk.js` that escapes the prefix. Code-split apps deployed under a CDN prefix now resolve their chunks and file-loader assets correctly. [#33385](https://github.com/oven-sh/bun/pull/33385)
- Fixed concurrent `bun build` processes (as spawned by concurrently or turbo) non-deterministically stalling for ~10 seconds instead of ~10 ms; a thread-pool shutdown race left a worker sleeping until its idle timeout. [#32494](https://github.com/oven-sh/bun/pull/32494)
- `bun build --splitting` with `--format=cjs` or `--format=iife` now fails with a clear "only supported with esm" error instead of panicking; `Bun.build()` returns the same as a catchable build error.
- Bundled CommonJS dependencies that set `module.exports = null` (or any primitive) no longer crash at load time.
- Top-level `arguments` in bundled CommonJS resolves to the module wrapper's arguments instead of throwing `ReferenceError` in ESM output.
- Fixed a local variable named `jsx`, `jsxDEV`, `jsxs`, `Fragment`, or `createElement` in the same scope as the first JSX element aliasing the automatic JSX runtime import and causing `TypeError: jsx is not a function` at runtime. [#32593](https://github.com/oven-sh/bun/pull/32593)
- Fixed decorator lowering for class fields whose key is a string literal containing non-ASCII characters; the decorated field previously landed on a garbage property name at runtime. [#32713](https://github.com/oven-sh/bun/pull/32713)
- **CSS**: `calc()` results of NaN serialize as `0` per CSS Values 4 instead of the invalid literal `NaNpx`. [#33147](https://github.com/oven-sh/bun/pull/33147)
- **CSS**: `:nth-child(... of <list>)` and `:has()` with an empty selector list are now rejected as invalid instead of emitted. [#33151](https://github.com/oven-sh/bun/pull/33151)
- **CSS**: CSS-modules `animation`/`animation-name` now scope the referenced `@keyframes` name to the same hash the definition receives. [#33322](https://github.com/oven-sh/bun/pull/33322)
- Fixed repeated in-process `Bun.build()` calls failing with `EBADF` when a package is reached through a symlinked `node_modules` entry; the parse task was closing a file descriptor it had borrowed from the resolver cache. [#33102](https://github.com/oven-sh/bun/pull/33102)

### Other Node.js fixes

- `bun --bun jest` runs. `require("module").prototype` is non-enumerable, as in Node, so jest no longer fails with "Attempted to assign to readonly property". [#39535](https://github.com/oven-sh/bun/pull/39535)
- A TCP peer reset behind unread data is reported as `ECONNRESET`, not a clean `end`. [#39600](https://github.com/oven-sh/bun/pull/39600)
- On macOS, a peer reset on a paused socket is reported instead of leaving the socket open forever. [#39610](https://github.com/oven-sh/bun/pull/39610)
- `node:http` no longer writes `Connection: close` into the body on `res.destroy()`. [#39364](https://github.com/oven-sh/bun/pull/39364)
- `node:http` no longer appends `Content-Length: 0` to a close-delimited streamed response. [#38701](https://github.com/oven-sh/bun/pull/38701)
- On Windows, `fs.writeFile(path, data, { flag: "a+" })` appends instead of overwriting from offset 0. [#39355](https://github.com/oven-sh/bun/pull/39355)
- **N-API**: return status codes on error paths now align with Node across a set of entry points — NULL env/out-params return `napi_invalid_arg`, calls with a pending exception return `napi_pending_exception` on the entry points Node gates, and `napi_define_properties`/`freeze`/`seal`/`type_tag`/element accessors coerce primitives via `ToObject` like Node.
- `napi_get_all_property_names` `napi_key_*` filters (own-only skip_strings/skip_symbols, and writable/configurable on Proxy and String wrappers) match Node. [#34134](https://github.com/oven-sh/bun/pull/34134) [#34129](https://github.com/oven-sh/bun/pull/34129) [#34144](https://github.com/oven-sh/bun/pull/34144) [#34143](https://github.com/oven-sh/bun/pull/34143) [#34142](https://github.com/oven-sh/bun/pull/34142) [#34126](https://github.com/oven-sh/bun/pull/34126) [#34479](https://github.com/oven-sh/bun/pull/34479)
- `napi_get_all_property_names` handles accessor properties under every `napi_key_*` filter.
- **N-API**: threadsafe functions stay alive after their env is torn down.
- **N-API**: threadsafe functions are finalized when the last ref is released after abort.
- **N-API**: threadsafe functions receive `NULL` in `call_js` when no JS function was supplied.
- **N-API**: pending exceptions are cleared between finalizers during environment cleanup.
- **N-API**: Async cleanup hook handles stay alive until the addon removes them.
- **V8 C++ API**: `ReturnValue` contents stay alive across `HandleScope` pops. [#37159](https://github.com/oven-sh/bun/pull/37159)
- **V8 C++ API**: `v8::Value::IsArray` matches V8's `JSArray` type check instead of the spec `IsArray` operation, so Proxy-wrapped arrays are no longer treated as arrays and revoked proxies no longer throw. [#34149](https://github.com/oven-sh/bun/pull/34149)
- **[`node:http2`](https://nodejs.org/api/http2.html)**: frame writing over JS-backed transport sockets, padded `DATA` frames, re-entrant `streamStart` callbacks, and inbound `HEADERS` parsing are hardened.
- **[`node:http2`](https://nodejs.org/api/http2.html)**: corked frames stay scoped to their own session.
- Destroying a session during the writable flush loop is handled.
- **[`node:http`](https://nodejs.org/api/http.html)**: chunked responses to HTTP/1.0 clients are well-formed.
- **[`node:http`](https://nodejs.org/api/http.html)**: resizable `ArrayBuffer`s write correctly under backpressure.
- **[`node:http`](https://nodejs.org/api/http.html)**: `'error'` `ECONNRESET` and `'close'` ordering on aborted request bodies matches Node.
- **[`node:http`](https://nodejs.org/api/http.html)**: `req.socket` emits `'pause'` when the body buffer fills.
- **[`node:http`](https://nodejs.org/api/http.html)**: request lines are validated strictly and rejected via `clientError`.
- **[`node:http`](https://nodejs.org/api/http.html)**: already-written response bytes are drained when the client half-closes. [#35034](https://github.com/oven-sh/bun/pull/35034)
- **[`node:http`](https://nodejs.org/api/http.html)**: Unread request body is drained after `res.socket.end()`. [#34356](https://github.com/oven-sh/bun/pull/34356)
- **[`node:http`](https://nodejs.org/api/http.html)**: Upgrade sockets emit `'close'` when the WebSocket peer disconnects. [#32737](https://github.com/oven-sh/bun/pull/32737)
- **[`node:http`](https://nodejs.org/api/http.html)**: `process.binding('http_parser')` exposes the `M-SEARCH` method token. [#35277](https://github.com/oven-sh/bun/pull/35277)
- **[`node:tls`](https://nodejs.org/api/tls.html)**: `getSession()`/`getTLSTicket()` return the resumable ticket-bearing session on TLS 1.3. [#36475](https://github.com/oven-sh/bun/pull/36475) [#32630](https://github.com/oven-sh/bun/pull/32630)
- **[`node:tls`](https://nodejs.org/api/tls.html)**: error routing, `manualStart` reads, handshake timeout, and `setSecureContext` edge cases are fixed. [#35006](https://github.com/oven-sh/bun/pull/35006) [#32630](https://github.com/oven-sh/bun/pull/32630)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `WriteStream` no longer closes its fd before an in-flight write completes. [#34803](https://github.com/oven-sh/bun/pull/34803)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `WriteStream.write()` after `destroy()` fails with `ERR_STREAM_DESTROYED` on the fast path. [#34267](https://github.com/oven-sh/bun/pull/34267)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `ReadStream` no longer leaks its fd on destroy with `{ start, autoClose }`. [#30920](https://github.com/oven-sh/bun/pull/30920)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `watchFile` no longer fires queued callbacks after close. [#36926](https://github.com/oven-sh/bun/pull/36926)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: Recursive `fs.watch` inotify subtree failures surface as `'error'` events. [#36415](https://github.com/oven-sh/bun/pull/36415)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `fs.close(0/1/2)` actually closes the standard descriptors. [#33561](https://github.com/oven-sh/bun/pull/33561)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `mkdtemp()` honors `encoding`. [#33844](https://github.com/oven-sh/bun/pull/33844)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `appendFile` honors explicit `flag: 'w'`. [#36553](https://github.com/oven-sh/bun/pull/36553)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: Non-bigint `statfs` no longer truncates to i32. [#36503](https://github.com/oven-sh/bun/pull/36503)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `BigIntStats` returns correct negative nanosecond values for pre-epoch times. [#36187](https://github.com/oven-sh/bun/pull/36187)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `utimes` handles negative fractional string timestamps. [#34701](https://github.com/oven-sh/bun/pull/34701)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `promises.glob()`/`promises.watch()` validation and event prototypes match Node. [#34196](https://github.com/oven-sh/bun/pull/34196) [#34279](https://github.com/oven-sh/bun/pull/34279)
- `Readable#pause()` is a no-op on already-destroyed streams (matching Node's post-pipe flow state). [#33467](https://github.com/oven-sh/bun/pull/33467) [#34593](https://github.com/oven-sh/bun/pull/34593) [#34025](https://github.com/oven-sh/bun/pull/34025) [#34031](https://github.com/oven-sh/bun/pull/34031) [#37183](https://github.com/oven-sh/bun/pull/37183) [#32627](https://github.com/oven-sh/bun/pull/32627)
- **[`node:events`](https://nodejs.org/api/events.html)**: single listeners are stored bare with copy-on-write arrays (matching Node's internal shape).
- **[`node:events`](https://nodejs.org/api/events.html)**: `addAbortListener` fires even when another listener calls `stopImmediatePropagation`.
- **[`node:events`](https://nodejs.org/api/events.html)**: `EventEmitter.listenerCount()` validates its emitter argument.
- **[`node:events`](https://nodejs.org/api/events.html)**: a `ReferenceError` in `listenerCount` is fixed.
- **[`process`](https://nodejs.org/api/process.html)**: `'beforeExit'` no longer emits after a fatal uncaught exception. [#34639](https://github.com/oven-sh/bun/pull/34639)
- **[`process`](https://nodejs.org/api/process.html)**: `reallyExit()` no longer emits `'exit'` listeners. [#34997](https://github.com/oven-sh/bun/pull/34997)
- **[`process`](https://nodejs.org/api/process.html)**: Errors thrown in `beforeExit`/`exit` listeners route to `'uncaughtException'`. [#33466](https://github.com/oven-sh/bun/pull/33466)
- **[`process`](https://nodejs.org/api/process.html)**: Throwing `'data'` listeners on stdin no longer destroy stdin. [#34019](https://github.com/oven-sh/bun/pull/34019)
- **[`process`](https://nodejs.org/api/process.html)**: File-backed stdout/stderr can be written after `end()`. [#33618](https://github.com/oven-sh/bun/pull/33618)
- **[`process`](https://nodejs.org/api/process.html)**: Piped stdout/stderr correctly errors on write-after-end. [#33557](https://github.com/oven-sh/bun/pull/33557)
- **Module resolution**: running Bun as `node` no longer auto-loads `.env` files.
- **Module resolution**: wildcard `exports`/`imports` targets auto-resolve extensions.
- **Module resolution**: `"."` and `".."` specifiers are treated as directories.
- **Module resolution**: `Module._nodeModulePaths` strips trailing separators.
- **Module resolution**: `module._resolveFilename` validates its argument.
- **[`node:buffer`](https://nodejs.org/api/buffer.html)**: `toString`/`write` handle buffers of `MAX_LENGTH` bytes.
- **[`node:buffer`](https://nodejs.org/api/buffer.html)**: `indexOf`/`lastIndexOf` with a negative offset and a Buffer (not string) needle under `ucs2`/`utf16le` wraps against the raw byte length as Node does.
- **[`node:buffer`](https://nodejs.org/api/buffer.html)**: the internal `<encoding>Slice`/`<encoding>Write` bindings match Node's semantics.
- **[`node:dns`](https://nodejs.org/api/dns.html)**: pending queries always time out.
- **[`node:dns`](https://nodejs.org/api/dns.html)**: `resolve` throws `ERR_INVALID_ARG_TYPE` for undefined `rrtype`.
- **[`node:dns`](https://nodejs.org/api/dns.html)**: `Resolver`/`setServers`/`lookupService` validation matches Node.
- **[`node:vm`](https://nodejs.org/api/vm.html)**: property definition in sandboxed contexts crash is fixed.
- **[`node:vm`](https://nodejs.org/api/vm.html)**: `createContext` throws when a context option getter throws.
- `Error.captureStackTrace` installs `.stack` as non-enumerable (matching V8). [#34259](https://github.com/oven-sh/bun/pull/34259)
- `Error.stackTraceLimit` stays in sync with the limit actually used for captures. [#34263](https://github.com/oven-sh/bun/pull/34263)
- `assert.deepEqual` throws `TypeError` on detached `ArrayBuffer`s. [#34587](https://github.com/oven-sh/bun/pull/34587)
- **[`node:worker_threads`](https://nodejs.org/api/worker_threads.html)**: workers no longer hang when captured stdout/stderr is never consumed. [#34338](https://github.com/oven-sh/bun/pull/34338)
- **[`node:perf_hooks`](https://nodejs.org/api/perf_hooks.html)**: exports the real `performance` object with correct entry prototypes. [#34518](https://github.com/oven-sh/bun/pull/34518)
- **[`node:tty`](https://nodejs.org/api/tty.html)**: raw mode is tracked per-handle instead of per-process. [#33527](https://github.com/oven-sh/bun/pull/33527)
- **[`node:timers`](https://nodejs.org/api/timers.html)**: timers reschedule when `_idleStart` is written, matching Node's internals. [#36859](https://github.com/oven-sh/bun/pull/36859)
- **[`node:string_decoder`](https://nodejs.org/api/string_decoder.html)**: state resets correctly after completing a buffered partial character. [#33703](https://github.com/oven-sh/bun/pull/33703)
- **[`node:os`](https://nodejs.org/api/os.html)**: fixed IPv6 address, netmask, and CIDR formatting in `os.networkInterfaces()`. [#32300](https://github.com/oven-sh/bun/pull/32300)
- **[`node:dgram`](https://nodejs.org/api/dgram.html)**: compatibility improved to match Node v26.3.0 behavior. [#32625](https://github.com/oven-sh/bun/pull/32625)
- `createTagStore()` capacity is now coerced like Node (double→int→size_t, so `-1` means unlimited and `0` caches nothing). [#34454](https://github.com/oven-sh/bun/pull/34454)
- Explicit-`undefined` option rejection matches Node's arity-based validation. [#34450](https://github.com/oven-sh/bun/pull/34450)
- **[`node:http2`](https://nodejs.org/api/http2.html)**: `request()` no longer sends headers out of order when an options getter calls `request()` again; options are now copied before encoding. [#31323](https://github.com/oven-sh/bun/pull/31323)
- `node:vm` `SyntheticModule` works together with `node:async_hooks`, fixing `react-email`'s preview server.
- `node:https` now honors `ca` and other TLS options passed via the `agent`. [#25937](https://github.com/oven-sh/bun/pull/25937)
- Passing a custom `lookup` function to `node:http`/`node:https` no longer breaks SNI and certificate validation, fixing axios with custom DNS resolution. [#25937](https://github.com/oven-sh/bun/pull/25937)
- `node:http` server now delivers data pipelined immediately after a CONNECT request to the `'connect'` event's `head` parameter, fixing CONNECT tunneling from Cloudflare's workerd. [#25938](https://github.com/oven-sh/bun/pull/25938)
- `fs.stat` on Linux now works inside older Docker containers and locked-down sandboxes that previously blocked the underlying system call. [#28825](https://github.com/oven-sh/bun/pull/28825)
- `fs.cp`/`fs.cpSync` on Linux and FreeBSD now correctly preserve symlink targets instead of creating links pointing back at the source symlink's own path. [#30073](https://github.com/oven-sh/bun/pull/30073)
- `fs.statfs()` on Intel macOS no longer returns field-shifted garbage (`bsize: 0`), fixing disk-space checks in tools like Unity Hub. [#31139](https://github.com/oven-sh/bun/pull/31139)
- `os.freemem()` on Linux now reports the memory that is actually available, matching Node.js, instead of a much smaller number that ignored disk cache the kernel can free on demand. [#29080](https://github.com/oven-sh/bun/pull/29080)
- `process.ppid` is now a live getter, so the orphan-detection pattern `if (process.ppid === 1) process.exit()` works after the parent dies. [#29171](https://github.com/oven-sh/bun/pull/29171)
- Unix domain socket binding now returns `EADDRINUSE` instead of silently unlinking an existing socket and stealing the address. [#28798](https://github.com/oven-sh/bun/pull/28798)
- The Unix domain socket `.sock` file is cleaned up on `close()`. [#28798](https://github.com/oven-sh/bun/pull/28798)
- `Buffer.copyBytesFrom(view)` no longer returns wrong bytes (or throws a spurious out-of-memory error) when the view has a non-zero `byteOffset`. [#30132](https://github.com/oven-sh/bun/pull/30132)
- Dynamic `import()` of unknown `node:` modules inside CommonJS is now deferred to runtime instead of failing at transpile time, unblocking Next.js + turbopack + Better Auth probing for `node:sqlite`. [#26981](https://github.com/oven-sh/bun/pull/26981)
- **[`node:crypto`](https://nodejs.org/api/crypto.html)**: `createCipheriv()` and `createDecipheriv()` reject a GCM IV longer than 128 bytes with `ERR_CRYPTO_INVALID_IV`, as Node does, instead of producing ciphertext Node cannot decrypt. [#34092](https://github.com/oven-sh/bun/pull/34092)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `fs.mkdtemp("")` in its sync, callback, and promise forms fails with `EINVAL` like Node instead of creating a six-character directory in the working directory. [#34908](https://github.com/oven-sh/bun/pull/34908)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `fs.createWriteStream()` no longer overwrites the start of the file with the unwritten tail of a short write; it retries at the current offset, and a write that then fails (for example `EFBIG`) emits `'error'` instead of `'finish'`. [#36135](https://github.com/oven-sh/bun/pull/36135)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `fs.write`, `fs.writev`, and `fs.readv` ignore a `position` that is not a safe integer (`NaN`, `Infinity`, `1.5`, a BigInt) and use the current offset, matching Node. [#36135](https://github.com/oven-sh/bun/pull/36135)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `fs.write` and `fs.writeSync` throw `ERR_OUT_OF_RANGE` for an `offset` past the end of the buffer when no `length` is passed, instead of writing 0 bytes. [#37632](https://github.com/oven-sh/bun/pull/37632)
- **[`node:dns`](https://nodejs.org/api/dns.html)**: on Linux, `dns.lookup()` now uses the system resolver (`getaddrinfo`) like Node. Before, it used c-ares, the resolver library Bun bundles. c-ares reads `/etc/resolv.conf` itself. So on hosts using systemd-resolved or a split-DNS VPN, names that Node resolved failed in Bun. `dns.promises.lookup()` and `net.connect()` by hostname are covered. `Bun.dns.lookup()` still defaults to c-ares on Linux. [#37383](https://github.com/oven-sh/bun/pull/37383)
- **[`node:dns`](https://nodejs.org/api/dns.html)**: `dns.lookup()` and `dns.promises.lookup()` treat a `null` `hints`, `all`, or `verbatim` option as unset, as Node does, instead of throwing `ERR_INVALID_ARG_TYPE`. [#37319](https://github.com/oven-sh/bun/pull/37319)
- **[`node:dns`](https://nodejs.org/api/dns.html)**: `dns.lookupService()` resolves IPv4-mapped IPv6 addresses such as `::ffff:127.0.0.1` instead of failing with `ENOTFOUND`. [#37490](https://github.com/oven-sh/bun/pull/37490)
- **[`process`](https://nodejs.org/api/process.html)**: the default `'warning'` printer is registered as a listener at startup, as in Node, so `process.removeAllListeners("warning")` silences it and `process.emit("warning", err)` prints. [#37344](https://github.com/oven-sh/bun/pull/37344)
- **[`node:http2`](https://nodejs.org/api/http2.html)**: `session.setNextStreamID(0.5)` on a fresh client leaves the next stream ID at `1`, as in Node, instead of overflowing.
- **[`node:http2`](https://nodejs.org/api/http2.html)**: `session.state.nextStreamID` no longer reports `0` when a server session reaches `2 ** 32 - 1`.
- **[`node:http2`](https://nodejs.org/api/http2.html)**: sessions now have `goawayCode` and `goawayLastStreamID`, set from a received `GOAWAY` before `'goaway'` is emitted and kept after the session is destroyed. They were `undefined`, so a `goawayCode !== NGHTTP2_NO_ERROR` check treated every session as errored. [#37550](https://github.com/oven-sh/bun/pull/37550)
- **[`node:http2`](https://nodejs.org/api/http2.html)**: `pushStream()` now sends an array header value as one field per element. So `"set-cookie": ["c1=1", "c2=2"]` arrives as two cookies rather than one comma-joined value. An array (or a duplicate) for a single-value header such as `content-type` throws `ERR_HTTP2_HEADER_SINGLE_VALUE`. Both match Node. [#37579](https://github.com/oven-sh/bun/pull/37579)
- **[`node:net`](https://nodejs.org/api/net.html)**: on Linux, an `allowHalfOpen` socket (which every `node:http` server socket is) whose `AF_UNIX` peer closes first emits `'end'` and closes. A paused socket keeps the bytes it received before the peer closed until `resume()`, then ends and closes.
- **`util.inspect.custom` on web classes**: assigning `Symbol.for("nodejs.util.inspect.custom")` on a `URL` instance in strict-mode code no longer throws `TypeError: Attempted to assign to readonly property`. That broke SvelteKit SSR. The prototype property is now writable on `URL`, `URLSearchParams`, `CryptoKey`, `BroadcastChannel`, and the web stream classes. This matches Node. [#38106](https://github.com/oven-sh/bun/pull/38106)
- **[`node:worker_threads`](https://nodejs.org/api/worker_threads.html)**: a worker's `process.stdout` and `process.stderr` output now all reaches the parent when the worker exits synchronously (`process.exit()`, an uncaught exception, or an unhandled rejection). Previously everything after the first write was dropped. `worker.terminate()` still does not flush, as in Node. [#38229](https://github.com/oven-sh/bun/pull/38229)
- **[`node:worker_threads`](https://nodejs.org/api/worker_threads.html)**: `process.exitCode` set inside an `'exit'` listener is now honored, in workers and on the main thread. [#38229](https://github.com/oven-sh/bun/pull/38229)
- **[`node:net`](https://nodejs.org/api/net.html)**: asynchronous `connect` failures now carry Node's ` - Local (address:port)` suffix when the local address is known, so `connect ECONNREFUSED 127.0.0.1:12399 - Local (127.0.0.1:12400)` reads the same as in Node. [#34523](https://github.com/oven-sh/bun/pull/34523)
- **[`node:console`](https://nodejs.org/api/console.html)**: `new Console({ inspectOptions })` now honors a `Map` keyed by stream, so stdout and stderr can be formatted differently; previously the `Map` was treated as a plain options object and per-stream colors did nothing. [#34523](https://github.com/oven-sh/bun/pull/34523)
- **[`node:v8`](https://nodejs.org/api/v8.html)**: `v8.setFlagsFromString()` now rejects a non-string argument with `ERR_INVALID_ARG_TYPE`, as Node does, before throwing `ERR_NOT_IMPLEMENTED`. [#34523](https://github.com/oven-sh/bun/pull/34523)
- `v8.startupSnapshot.isBuildingSnapshot()` now returns `false` instead of throwing, unblocking bson (and therefore mongodb and @keyv/mongo) which calls it at import time. [#32502](https://github.com/oven-sh/bun/pull/32502)
- `process.stdin` in paused mode no longer drops the final partial chunk at EOF: `read(n)` returns the buffered remainder once the stream ends, and a bare `process.stdin.read()` with no `'readable'` listener now delivers data. [#33123](https://github.com/oven-sh/bun/pull/33123)
- `tty.WriteStream#getColorDepth()` no longer reports 256 colors for every terminal; TMUX and `xterm-kitty` now report 24-bit, GitHub Actions and CircleCI report truecolor, and empty `NO_COLOR` is ignored per no-color.org. [#33124](https://github.com/oven-sh/bun/pull/33124)
- `fs.readdir(path, { recursive: true })` no longer silently drops entries whose relative path approached `MAX_PATH_BYTES` (~1022 bytes on macOS, ~4094 on Linux); long paths now spill to a heap buffer.
- `fs.promises.readdir(path, { recursive: true })` completes when multiple per-directory subtasks fail.
- `fs.open`/`openSync`/`readFile`/`writeFile` now accept a numeric `flags` argument that arrived as a double (e.g. read from a `Float64Array`), fixing Go programs compiled with `GOOS=js GOARCH=wasm` whose syscall bridge delivers every argument that way. [#32506](https://github.com/oven-sh/bun/pull/32506)
- `fs.open()` now validates flag and mode strings strictly, rejecting uppercase flags like `"W"` and non-octal mode strings with `ERR_INVALID_ARG_VALUE` instead of silently opening the file. [#32966](https://github.com/oven-sh/bun/pull/32966)
- `node:fs` errors now report Node's platform-independent operation name in `error.syscall` (`"stat"`, `"lstat"`, `"utime"`) instead of the raw syscall Bun issued (`"statx"`, `"utimensat"`), so packages that branch on `err.syscall` match correctly. [#32964](https://github.com/oven-sh/bun/pull/32964)
- Aborted `node:fs` and `node:fs/promises` operations now reject with an `AbortError` whose `code` is `'ABORT_ERR'`, matching Node.js.
- On Linux, `fs.watch()` now emits both `rename` events with the correct basename when the watched path itself is deleted or moved, matching Node.js. [#32962](https://github.com/oven-sh/bun/pull/32962)
- `node:net`'s `autoSelectFamily` (Happy Eyeballs) path no longer throws an uncaught `TypeError: null is not an object` when `connect()` fails synchronously, common on macOS when DNS returns unroutable IPv6 addresses. [#32660](https://github.com/oven-sh/bun/pull/32660)
- `node:http` tolerates cleared `onwritable`/`ondata`/`onabort` callback slots on the socket.
- `socket.connect()` in `node:net` on a socket that already has a live native handle is handled.
- TLS handshake failures discovered from a write issued before `secureConnect` (as `https.request` does) now report the handshake's own error code instead of being misreported as `ERR_TLS_CERT_ALTNAME_INVALID`. [#33390](https://github.com/oven-sh/bun/pull/33390)
- `X509Certificate.checkHost()` now returns the subject name that matched (e.g. `*.wildcard.example.com`) instead of echoing back the hostname you passed in. [#33299](https://github.com/oven-sh/bun/pull/33299)
- `crypto.createHash()` and `crypto.hash()` now accept the hyphenated and mixed-case algorithm aliases Node.js accepts (`"shake-128"`, `"SHAKE256"`, `"BLAKE2s256"`). [#32439](https://github.com/oven-sh/bun/pull/32439)
- `crypto.subtle.wrapKey()` with `AES-KW` and `"jwk"` format now pads the serialized JWK to a multiple of 8 bytes; previously it threw `OperationError` for any key whose JWK wasn't already 8-byte-aligned (e.g. HMAC SHA-512). [#32616](https://github.com/oven-sh/bun/pull/32616)
- `cipher.setAAD()` on a non-AEAD cipher such as `aes-128-cbc` throws `ERR_CRYPTO_INVALID_STATE`.
- `crypto.Hmac`'s native `update()` throws `ERR_INVALID_THIS` when called with a wrong receiver.
- Bun's `node:crypto` implementation now includes upstream correctness fixes from Node.js that tighten error handling in low-level cipher and memory-allocation code paths. [#33202](https://github.com/oven-sh/bun/pull/33202)
- `node:zlib` native handle lifecycle crash fixed, including `dictionary` validation in `zlib.deflateSync`.
- `Readable.fromWeb()` no longer reorders chunks when composed with `Readable.toWeb()`; concurrent pump loops on the same reader could interleave and permute the stream. [#33300](https://github.com/oven-sh/bun/pull/33300)
- `child.kill()` now returns `false` when the child has already exited, matching Node.js and making `kill(0)` usable as a liveness probe. [#32877](https://github.com/oven-sh/bun/pull/32877)
- `process.execve()` throws an `ErrnoException` when the underlying syscall fails (`ENOENT`, `EACCES`), and restores file-descriptor flags and the signal mask on failure.
- `process.hrtime([a, b])` coerces tuple elements with `ToNumber` like Node.js.
- `dgram.Socket` methods called after `close()` now throw `ERR_SOCKET_DGRAM_NOT_RUNNING` instead of an uncoded internal `TypeError`. [#33024](https://github.com/oven-sh/bun/pull/33024)
- `dgram.Socket` `[Symbol.asyncDispose]()` on a closed socket resolves instead of rejecting. [#33024](https://github.com/oven-sh/bun/pull/33024)
- `dgram.Socket.prototype.bind()` on an already-bound socket now throws `ERR_SOCKET_ALREADY_BOUND` synchronously instead of emitting an `'error'` event. [#33037](https://github.com/oven-sh/bun/pull/33037)
- `Buffer.alloc(n, pattern, enc)` and `buf.fill(pattern, enc)` now byte-truncate the pattern's encoding when it's longer than the destination. [#33019](https://github.com/oven-sh/bun/pull/33019)
- `Buffer.alloc(n, pattern, enc)` and `buf.fill(pattern, enc)`: lone high surrogates encode as U+FFFD instead of throwing. [#33019](https://github.com/oven-sh/bun/pull/33019)
- `Buffer.prototype.fill` now matches Node's offset/end handling: string offsets on non-string values throw `ERR_INVALID_ARG_TYPE`, an undefined offset ignores end, and a null or empty-string encoding is treated as utf8. [#33033](https://github.com/oven-sh/bun/pull/33033)
- `Buffer.from(arrayBuffer, byteOffset, length)` now clamps negative and NaN lengths to 0 instead of throwing. [#33036](https://github.com/oven-sh/bun/pull/33036)
- `Buffer.from(arrayBuffer, byteOffset, length)` honors an explicit length on resizable ArrayBuffers instead of always returning a length-tracking view. [#33036](https://github.com/oven-sh/bun/pull/33036)
- `structuredClone`, worker `postMessage`, and the `Worker` `transferList` option now validate the transfer list per WebIDL before serializing, throwing `TypeError` on invalid entries instead of silently detaching the valid buffers. [#32809](https://github.com/oven-sh/bun/pull/32809)
- `path.normalize()` and `path.join()` now correctly handle a first segment ending in `..` (such as `"bb../../x"`), matching Node.js. [#32783](https://github.com/oven-sh/bun/pull/32783)
- `new StringDecoder(enc).encoding` and `Readable#readableEncoding` now normalize all UTF-16LE aliases (`ucs2`, `ucs-2`, `utf-16le`) to `"utf16le"`. [#33038](https://github.com/oven-sh/bun/pull/33038)
- `napi_is_arraybuffer` now returns `false` for `SharedArrayBuffer`, matching Node.js. [#32629](https://github.com/oven-sh/bun/pull/32629)
- `navigator.userAgent`, `navigator.platform`, and `navigator.hardwareConcurrency` are now read-only accessors instead of writable data properties, matching Node.js and browsers. [#32440](https://github.com/oven-sh/bun/pull/32440)
- `queueMicrotask.length` now reports 1 instead of 2, matching the HTML spec, browsers, and Node.js. [#32419](https://github.com/oven-sh/bun/pull/32419)
- Calling `socket.destroySoon()` or `socket.destroy()` on a TLS socket after a large write could drop the tail of the stream while still signaling a clean close, so the receiver saw a short read with no error. Pending encrypted bytes are now flushed before the socket closes. [#32719](https://github.com/oven-sh/bun/pull/32719)
- `fs.write`, `fs.writeSync`, and `filehandle.write` now apply the encoding argument when writing a string. Previously the encoding was parsed and then ignored, so `fs.writeSync(fd, "abc", 0, "utf16le")` silently wrote UTF-8 bytes. [#32813](https://github.com/oven-sh/bun/pull/32813)
- `fs.writeFile` and `fs.writeFileSync` no longer truncate files opened with a non-truncating flag (`r+`, `rs+`, or numeric `O_RDWR`), which is the documented way to patch a region in place. [#33355](https://github.com/oven-sh/bun/pull/33355)
- `fs.writeFile` and `fs.writeFileSync`: Also fixed: `flag: "a"` on Linux leaving a hole of zeroes before the appended data. [#33355](https://github.com/oven-sh/bun/pull/33355)
- `fs.writeFile` and `fs.writeFileSync`: Also fixed: partial-write failures leaving the old file's stale tail behind the bytes that did land. [#33355](https://github.com/oven-sh/bun/pull/33355)
- `tls.connect({ socket })` and `new TLSSocket(socket)` work when both ends of an in-process `duplexPair()` are wrapped in TLS.
- `socket.end()` sends `close_notify` before FIN so the peer sees a clean shutdown.
- A handshake rejected by certificate verification fails closed on every code path.

### Other package manager fixes

- `bun outdated` and `bun update -i` exit 1 with the error when a manifest cannot be fetched, instead of printing an empty table and exit 0. [#38809](https://github.com/oven-sh/bun/pull/38809)
- Credentials in a registry URL are sent as `Authorization`, whether the URL comes from `--registry`, `BUN_CONFIG_REGISTRY`, `npm_config_registry`, or a bunfig `registry = { url }` object. Bun 1.3 dropped them. [#38796](https://github.com/oven-sh/bun/pull/38796) [#38824](https://github.com/oven-sh/bun/pull/38824)
- A git dependency is cloned into a staging directory and moved into the cache only when the clone completes, so a killed install no longer leaves a half-cloned package that later resolves as valid. [#38269](https://github.com/oven-sh/bun/pull/38269)
- `bun patch` works for git and tarball dependencies. [#38269](https://github.com/oven-sh/bun/pull/38269)
- **`bun pm pack`** now always includes files referenced by `"bin"` and `"directories.bin"` in the tarball even when they aren't listed in `"files"`, matching npm. [#23606](https://github.com/oven-sh/bun/pull/23606)
- **`bun pm pack` and `bun publish`** now re-read `package.json` after `prepublishOnly`, `prepack`, and `prepare` run, so version bumps made by lifecycle scripts land in the tarball filename and registry metadata. [#26267](https://github.com/oven-sh/bun/pull/26267)
- **`.npmrc` parsing** now expands environment variables inside quoted values. [#25518](https://github.com/oven-sh/bun/pull/25518)
- **`.npmrc` parsing** supports npm's `${VAR?}` optional modifier. [#25518](https://github.com/oven-sh/bun/pull/25518)
- **`.npmrc` parsing** reads the `email` field for registries (like Sonatype Nexus) that require it. [#25518](https://github.com/oven-sh/bun/pull/25518)
- **`--frozen-lockfile`** now respects scope-specific registries from `bunfig.toml` when the lockfile entry has an empty registry URL. [#26047](https://github.com/oven-sh/bun/pull/26047)
- **Optional peer dependencies** now resolve to an installed package when one is available instead of being left unresolved, fixing duplicated packages under `node_modules/.bun` in monorepos. [#24272](https://github.com/oven-sh/bun/pull/24272)
- **Lockfile migration** from npm/yarn/pnpm now creates the text-based `bun.lock` instead of the legacy binary `bun.lockb` when migration fails partway through. [#24494](https://github.com/oven-sh/bun/pull/24494)
- **Git dependencies** that point to the same repository via different protocols (`git+ssh://` vs `git+https://`) now resolve correctly. [#24138](https://github.com/oven-sh/bun/pull/24138)
- **Git dependencies**: GitHub URLs with custom protocol prefixes take the faster tarball path instead of a full clone. [#24138](https://github.com/oven-sh/bun/pull/24138)
- **The security scanner** now collects dependencies from all workspace packages, not just the root. [#24942](https://github.com/oven-sh/bun/pull/24942)
- **The security scanner**: every scanner failure path now prints a diagnostic instead of exiting silently with code 1. [#24942](https://github.com/oven-sh/bun/pull/24942)
- **The isolated linker** fails fast on integrity-check failures and error tarball responses.
- **The isolated linker**: Cross-filesystem installs now fall back to copying instead of hardlinking.
- **The isolated linker**: workspace packages get their self-link when they depend on themselves.
- **`bunx @scope/name`** always resolves the scoped package it names.
- Rare crashes in `bun install`, `bun add`, `bun pm ls`, `bun pm patch`, and `bun update --interactive` are fixed, including registry request retries, `.npmrc` `ca` cert handling, local tarball resolution, git specifier parsing, package names, and lifecycle script filtering.
- **Better error messages** when a `file:` dependency points at a missing or stale path: `bun install` now names the offending dependency instead of suggesting you run `bun init`. [#26339](https://github.com/oven-sh/bun/pull/26339)
- `bun init` now falls back to `-y` when stdin isn't a TTY. [#35165](https://github.com/oven-sh/bun/pull/35165)
- `bun update -i` now errors out early (pointing to `bun update`/`bun outdated`) instead of hanging. [#34858](https://github.com/oven-sh/bun/pull/34858)
- **`bun install`** now falls back to copying when hardlinking from the cache fails with `EACCES`/`EPERM`. [#36853](https://github.com/oven-sh/bun/pull/36853)
- **`postinstall`** now runs when Bun auto-injects `node-gyp rebuild` for a package with a `binding.gyp` but no `install` or `preinstall` script; previously the postinstall was silently dropped.
- `bun.lock` no longer keeps packages that are only reachable through an optional peer dependency's resolution slot. [#35681](https://github.com/oven-sh/bun/pull/35681)
- **`bun patch --commit`** now resolves paths correctly when run from inside a workspace package. [#36290](https://github.com/oven-sh/bun/pull/36290)
- Isolated installs no longer re-apply the same patch once per peer-dependency variant. [#33646](https://github.com/oven-sh/bun/pull/33646)
- **`--frozen-lockfile`** no longer spuriously rejects a lockfile when `npm:` aliases place duplicate package names in one tree node. [#36578](https://github.com/oven-sh/bun/pull/36578)
- **`npm:` alias dependencies** whose registry target name collides with a same-named alias elsewhere in the tree now resolve to the package they name instead of being redirected to the alias — fixing Microsoft's recommended TypeScript 6/7 coexistence setup. [#33835](https://github.com/oven-sh/bun/pull/33835)
- A tarball whose download already failed during resolution is no longer re-downloaded (and re-reported) during the install phase. [#34861](https://github.com/oven-sh/bun/pull/34861) [#34103](https://github.com/oven-sh/bun/pull/34103)
- **Nested `bun run --bun`** no longer creates a self-referencing `node` shim symlink and fails with `Too many levels of symbolic links`. [#30713](https://github.com/oven-sh/bun/pull/30713)
- **`Bun.semver.satisfies()`** no longer collapses `^`/`~`/x-range/hyphen ranges to an empty range when a version component is `u64::MAX`. [#34600](https://github.com/oven-sh/bun/pull/34600)
- **`BUN_DISABLE_SLOW_FILESYSTEM_WARNING=1`** suppresses the "slow filesystem detected" notice. [#37000](https://github.com/oven-sh/bun/pull/37000)
- **Git, `github:`, and tarball dependencies**: `bun install` from a lockfile with a cold cache now installs every git dependency that points at a different branch of the same repository (previously it installed one and exited 0). [#35426](https://github.com/oven-sh/bun/pull/35426)
- **Git, `github:`, and tarball dependencies**: a git, `github:`, or tarball dependency that appears both directly and transitively no longer fails with `failed to resolve`. [#35426](https://github.com/oven-sh/bun/pull/35426)
- **Git, `github:`, and tarball dependencies**: `git+file://` dependencies install instead of failing with `no commit matching`. [#35426](https://github.com/oven-sh/bun/pull/35426)
- **`$HOME/.npmrc`** is now read when `XDG_CONFIG_HOME` is set but `$XDG_CONFIG_HOME/.npmrc` does not exist, as on GitHub Actions `ubuntu-latest`. Previously `bun publish` there failed with `missing authentication` and `bun install` ignored the registry configured in `$HOME/.npmrc`. [#36289](https://github.com/oven-sh/bun/pull/36289)
- **`--frozen-lockfile`** no longer fails with `lockfile had changes` on an unchanged `bun.lock` when a root dependency satisfies a bundled package's optional peer (`cdk8s` bundles `follow-redirects`, whose optional peer `debug` is also a root dependency). [#37350](https://github.com/oven-sh/bun/pull/37350)
- **Long version labels** (a tarball or `file:` spec, or a workspace's own version) are handled by the hoisted linker.
- **Long version labels**: a `patchedDependencies` entry keyed by one is applied.
- **Long version labels**: `bun patch` and `bun patch --commit` handle long labels and report an error where the package cannot be patched.
- **`workspaces` entries** whose resolved path is longer than the platform path limit make `bun install` exit 1 with `ENAMETOOLONG`; the same applies to a glob match whose `package.json` path is too long. Over-long glob patterns match or are skipped like any other.

### `Bun.$` (shell)

- **`Bun.$` (shell)** `mv` falls back to copy+unlink across filesystems.
- **`Bun.$` (shell)** Bare `cd` changes to `$HOME`
- **`Bun.$` (shell)** Comma-less brace groups like `{abc}` are literals and nested groups keep trailing empty variants.
- **`Bun.$` (shell)** A redirect target that expands to multiple words is an error.
- **`Bun.$` (shell)** Redirects to FIFOs use the pollable writer path.
- **`Bun.$` (shell)** Redirecting an empty buffer to stdin delivers EOF instead of hanging.
- **`Bun.$` (shell)** `rm` no longer hangs on a lost wakeup between directory tasks.
- **`Bun.$` (shell)** `new $.Shell()` inherits env/cwd/throws defaults.
- **`Bun.$` (shell)** `$.escape` no longer corrupts Latin-1 characters. [#36338](https://github.com/oven-sh/bun/pull/36338) [#34822](https://github.com/oven-sh/bun/pull/34822) [#34856](https://github.com/oven-sh/bun/pull/34856) [#34865](https://github.com/oven-sh/bun/pull/34865) [#34324](https://github.com/oven-sh/bun/pull/34324) [#34696](https://github.com/oven-sh/bun/pull/34696) [#33994](https://github.com/oven-sh/bun/pull/33994) [#34032](https://github.com/oven-sh/bun/pull/34032) [#36409](https://github.com/oven-sh/bun/pull/36409) [#32933](https://github.com/oven-sh/bun/pull/32933)
- **`Bun.$` (shell)** `$.escape` no longer drops empty-string arguments. [#36338](https://github.com/oven-sh/bun/pull/36338) [#34822](https://github.com/oven-sh/bun/pull/34822) [#34856](https://github.com/oven-sh/bun/pull/34856) [#34865](https://github.com/oven-sh/bun/pull/34865) [#34324](https://github.com/oven-sh/bun/pull/34324) [#34696](https://github.com/oven-sh/bun/pull/34696) [#33994](https://github.com/oven-sh/bun/pull/33994) [#34032](https://github.com/oven-sh/bun/pull/34032) [#36409](https://github.com/oven-sh/bun/pull/36409) [#32933](https://github.com/oven-sh/bun/pull/32933)
- **`Bun.$` builtins** `.quiet()` accepts a boolean.
- **`Bun.$` builtins** `ls -l` prints a real long listing.
- **`Bun.$` builtins** `echo` supports `-e`/`-E`
- **`Bun.$` builtins** Empty-string arguments are no longer dropped (so `ssh-keygen -N ""` works)
- **`Bun.$` builtins** `[[ -f ]]` only matches regular files.
- **`Bun.$` builtins** Globbing into a nonexistent directory reports `no matches found` instead of aborting the process..
- The buffered pipe writer used by `Bun.$` and `spawn` stdin stays alive across async write completions on Windows.
- Bun Shell handles `epoll_ctl` failures during poll-driven pipe reads.
- Bun Shell handles synchronous redirect write failures such as `ENOSPC` gracefully.
- Shell completions for `bun run` no longer hide standalone scripts whose names start with `pre` or `post`, so prettier, postgres, postcss, and `preview` now tab-complete correctly. [#30088](https://github.com/oven-sh/bun/pull/30088)
- `bun run --elide-lines` is now a silent no-op when stdout isn't a TTY, so the same script works in both interactive shells and git hooks. [#28977](https://github.com/oven-sh/bun/pull/28977)
- Fish shell completions now include `bun update` and its flags. [#25978](https://github.com/oven-sh/bun/pull/25978)
- **`Bun.spawn()` and `Bun.$`**: fixed a leak of the writer that feeds a `Buffer` or `Blob` `stdin` to the child when the child closed its stdin before the buffer had drained (typically `EPIPE`). This affected the shell's `< ${buffer}` redirect on every POSIX platform and `Bun.spawn()` on macOS; on Linux `Bun.spawn()` passes the buffer as a memfd instead, so it only leaked where memfd was unavailable. [#37774](https://github.com/oven-sh/bun/pull/37774)
- **Windows dirfd-relative opens**: [~22 µs → 12–15 µs per call](https://github.com/oven-sh/bun/pull/33874) for common path shapes (~17 µs for relatives that resolve above the directory handle; bare names stay a ~10 ns passthrough). The `NtCreateFile` object name is built from the NT device path directly, skipping the mount-manager IOCTL that drive-letter lookup costs. Applies to tarball extraction, dirfd-relative `node:fs`, and shell file ops.
- Bun's crash handler now re-raises the original fault signal (SIGSEGV, SIGBUS, SIGFPE), or SIGABRT for panics, instead of always terminating with SIGILL, so shells and orchestrators see the real crash cause instead of "Illegal instruction".
- **Injection**: `Bun.spawn()`, `Bun.spawnSync()`, and Bun Shell reject NUL bytes in arguments, environment variables, `argv0`, and `cwd`.
- **Injection**: `Bun.sql` rejects NUL bytes in connection parameters.
- **Injection**: `Bun.s3` rejects CR/LF in `contentDisposition`, `contentEncoding`, and `type`.
- **Injection**: `node:dns` rejects hostnames with embedded NUL bytes.
- **Injection**: Bun Shell treats glob metacharacters arriving through interpolation as literals and keeps its internal delimiter out of reach of interpolated strings.
- **Injection**: `vm.createContext(DONT_CONTEXTIFY)` sandboxes get their own `Object.prototype`.
- File handles that Bun duplicates internally (for `Bun.file(fd).stream()`, a `fetch()` body made from `Bun.file(fd)`, a `FileSink` on an fd, and `Bun.$` subshells and pipelines) are created non-inheritable on Windows, as they already were on POSIX via `F_DUPFD_CLOEXEC`.
- **`Bun.$`**: pipeline write failures other than `EPIPE` are handled.
- **`Bun.$`**: `rm` no longer leaks when the directory-read loop aborts with child tasks already queued.
- **`Bun.$`**: spawn-time pipe failures are handled.
- **`Bun.$`**: multiple parse errors in `ShellError.message` are separated by newlines.
- **`Bun.$`**: the interpreter no longer leaks when finalized with subprocesses still running.
- **`Bun.$`**: `ls -a -A` respects flag order (last one wins).
- **`Bun.$`**: the `yes` builtin works when its stdout is captured.

### `Bun.sql`

- **`Bun.sql`**: a result column named `""` (for example `select ''` on MySQL or MariaDB) no longer crashes the process. [#38143](https://github.com/oven-sh/bun/pull/38143)
- **`Bun.sql` (MySQL)**: JSON columns from MariaDB parse into objects via extended-type-info negotiation. [#37130](https://github.com/oven-sh/bun/pull/37130)
- **`Bun.sql` (MySQL)**: column-count and structure mismatches are asserted instead of silently dropping values. [#36554](https://github.com/oven-sh/bun/pull/36554)
- **`Bun.sql` (MySQL)**: prepared statements assigned `statement_id` 0 by the server are rejected instead of silently misbehaving. [#33238](https://github.com/oven-sh/bun/pull/33238)
- **`Bun.sql` (Postgres)**: fixed memory leaks in array-typed columns and failed connections.
- **`Bun.sql` (Postgres)**: binary `NUMERIC` values smaller than 1e-8 decode correctly.
- **`Bun.sql` (Postgres)**: queries exceeding the 65,535-parameter wire limit throw `ERR_POSTGRES_TOO_MANY_PARAMETERS`.
- **`Bun.sql` (Postgres)**: multi-statement simple queries return the correct column names per result set.
- **`Bun.sql` (MySQL)** `SELECT` no longer silently returns zero rows against StarRocks, TiDB, and SingleStore.
- **`Bun.sql` (MySQL)** Memory usage stays flat across thousands of queries (column-name and prepared-statement buffers are now freed)
- **`Bun.sql` (MySQL)** `DATETIME`/`TIMESTAMP` round-trip as UTC.
- **`Bun.sql` (MySQL)** `YEAR` and computed `DECIMAL` columns decode correctly.
- **`Bun.sql` (MySQL)** BINARY/VARBINARY/BLOB return `Buffer` while binary-collated VARCHAR returns `string`
- **`Bun.sql` (MySQL)** `.raw()` no longer includes stray protocol bytes at the start of each value.
- **`Bun.sql` (MySQL)** A hang involving stored procedures and multi-statement queries has been fixed.
- **`Bun.sql` (MySQL)** Idle connections no longer hold the event loop open or spike CPU to 100% over TLS.. [#28005](https://github.com/oven-sh/bun/pull/28005) [#28633](https://github.com/oven-sh/bun/pull/28633) [#31212](https://github.com/oven-sh/bun/pull/31212)
- **`Bun.sql` (pool & helpers)** The `sql({...})` INSERT helper omits `undefined` so columns fall back to their `DEFAULT`
- **`Bun.sql` (pool & helpers)** Throwing inside `onconnect`/`onclose` no longer hangs the pool.
- **`Bun.sql` (pool & helpers)** `sql.close({ timeout: 0 })` resolves during a half-open handshake.
- **`Bun.sql` (pool & helpers)** New `ERR_*_CONNECTION_FAILED` codes distinguish "never connected" from "connection dropped".. [#25830](https://github.com/oven-sh/bun/pull/25830)
- `Bun.sql` (Postgres) could silently deliver one query's rows to a different query when a simple-protocol query ran concurrently with a not-yet-prepared parameterized query on the same connection. Simple-protocol queries include `.simple()`, parameter-less `sql.unsafe()`, and the `BEGIN`/`COMMIT`/`ROLLBACK` that `sql.begin()` issues. Bun was sending a redundant protocol message that pushed its reply queue out of step with the server. [#32772](https://github.com/oven-sh/bun/pull/32772)
- **JSON serialization**: [~3x faster](https://github.com/oven-sh/bun/pull/25733) across IPC, `console.log('%j')`, PostgreSQL/MySQL JSON columns, and Jest format specifiers. These paths now hit JavaScriptCore's SIMD-optimized FastStringifier instead of the slow path.
- **TLS** Hostname matching is one implementation across `fetch()`, `WebSocket`, `Bun.connect`, `Bun.sql`, and `X509Certificate#checkHost`, aligned with `tls.checkServerIdentity`
- **Native memory**: edge cases involving bounds and lifetime checks in `Buffer` (`concat`, `compare`, `indexOf`/`lastIndexOf`/`includes`), `crypto.randomFill`, `TextDecoder.decode`, `Bun.udpSocket` `send`/`sendMany`, `node:zlib`, structured-clone deserialization (`bun:jsc`, `node:v8`, advanced IPC), `node:fs` path handling and Windows path normalization, generated native-class setters called with a foreign receiver, the `.npmrc` INI parser, and the Postgres and MySQL wire parsers have been fixed
- **`Bun.sql` (Postgres)**: connection parameters are validated and reject null bytes with `ERR_INVALID_ARG_TYPE`.
- **`Bun.sql` (Postgres)**: a synchronous validation error on an idle pooled connection no longer wedges the event loop keep-alive and prevents exit.
- **`Bun.sql` (Postgres)**: backend message framing is validated.
- **`Bun.sql` (Postgres)**: connection-failure messages are handled regardless of how they arrive across TCP reads.
- **`Bun.sql` (MySQL)**: `caching_sha2_password` fast authentication against MySQL 8 now works instead of falling back to full authentication on every connect. [#33179](https://github.com/oven-sh/bun/pull/33179)
- **`Bun.sql` (MySQL)**: binary-protocol `NULL` on digit-named columns lands at the column's numeric name instead of index `0`. [#32367](https://github.com/oven-sh/bun/pull/32367)
- **`Bun.sql` (Postgres)**: `'infinity'::date`/`timestamp` values decode to `±Infinity` instead of invalid dates. [#35121](https://github.com/oven-sh/bun/pull/35121)
- **`Bun.sql` (Postgres)**: `DateStyle=ISO` is pinned on connect so a server default can't corrupt date parsing. [#35112](https://github.com/oven-sh/bun/pull/35112)
- **`Bun.sql` (Postgres)**: the wire-protocol parser enforces message-length frame boundaries and bounds `DataRow`/`RowDescription` reads. [#35114](https://github.com/oven-sh/bun/pull/35114) [#34436](https://github.com/oven-sh/bun/pull/34436)
- **`Bun.sql` (Postgres)**: out-of-range digit words are rejected when decoding binary `NUMERIC`. [#34429](https://github.com/oven-sh/bun/pull/34429)

### `Bun.spawn()`

- **`AbortSignal.timeout()`** now fires even if nothing is observing the signal when the deadline arrives, as in Node and browsers. Previously, removing the last abort listener, clearing `onabort`, closing an `fs.watch()` watcher the signal was passed to, or a `Bun.spawn()` child exiting cancelled the timer, so `aborted` stayed `false` and listeners attached later never fired.
- **`Bun.spawn()`**: relative `$PATH` entries are resolved against the `cwd` option.
- **`Bun.spawn()`**: the parent's cwd is inherited when no `cwd` is given.
- **`Bun.spawn()`**: an already-aborted `signal` throws `AbortError` immediately instead of spawning.
- **`Bun.spawn()`**: `timeout: NaN` and `killSignal: 0` are rejected with a validation error.
- **`Bun.spawn()`**: extra stdio file descriptors exposed via `.stdio` are no longer double-closed.
- **`Bun.spawn()`**: caller-supplied file descriptors are returned from `proc.stdio[N]` instead of `null`. [#29629](https://github.com/oven-sh/bun/pull/29629)
- `Bun.spawn` keeps the subprocess `stdout`/`stderr` reader alive while its pipe poll is armed.
- A `Bun.spawn` `stdout`/`stderr` stream reader can be cancelled from inside its own read callback.
- `Bun.spawn({ stdin: readableStream })` no longer surfaces an unhandled `EPIPE` rejection when the child exits while the internal stdin pump still has a write in flight. [#33021](https://github.com/oven-sh/bun/pull/33021)
- **[`node:child_process`](https://nodejs.org/api/child_process.html)**: stdin `EPIPE` emits `'error'` and destroys the stream.
- **[`node:child_process`](https://nodejs.org/api/child_process.html)**: the abort listener on `options.signal` is no longer leaked when spawn fails.
- **[`node:child_process`](https://nodejs.org/api/child_process.html)**: `stdio: 'overlapped'` string shorthand is accepted.
- **[`node:child_process`](https://nodejs.org/api/child_process.html)**: `spawn()` ignores `options.encoding`.
- **[`node:child_process`](https://nodejs.org/api/child_process.html)**: `subprocess.stdin` stays `null` after exit when stdio wasn't piped.
- `child_process` `maxBuffer` now stops reading and closes the pipe when the limit is hit instead of continuing to drain everything the child writes before it dies; stdout/stderr overshoot is bounded to at most 64 KB past the limit, matching Node.js. [#33309](https://github.com/oven-sh/bun/pull/33309) [#33330](https://github.com/oven-sh/bun/pull/33330)
- `spawnSync()` now forwards the `detached` option, so the child gets its own process group as documented. [#32874](https://github.com/oven-sh/bun/pull/32874)
- `spawn()` with `stdio: 'ignore'` at fd ≥ 3 now leaves that descriptor closed in the child instead of opening `/dev/null`, matching Node.js. [#32892](https://github.com/oven-sh/bun/pull/32892)
- **[`node:child_process`](https://nodejs.org/api/child_process.html)**: piped `stdout`/`stderr` now apply kernel backpressure instead of buffering unbounded in memory. [#34971](https://github.com/oven-sh/bun/pull/34971)
- **[`node:child_process`](https://nodejs.org/api/child_process.html)**: `child.stdout.pause()` is honored after the stream has started flowing. [#36035](https://github.com/oven-sh/bun/pull/36035)
- **[`node:child_process`](https://nodejs.org/api/child_process.html)**: `spawnSync` drains piped stdio to EOF after the child exits. [#33832](https://github.com/oven-sh/bun/pull/33832)
- Fixed Python asyncio-based subprocesses (including all Python MCP servers) breaking under `Bun.spawn`: Bun was prematurely signaling end-of-stream on the child's stdio pipes, which asyncio read as "connection closed". [#27435](https://github.com/oven-sh/bun/pull/27435)
- A rare bug causing silent data loss when reading subprocess pipes on Windows is fixed.
- Fixed `Bun.spawnSync({ timeout })` on Windows firing the timeout immediately if its isolated event loop had been idle longer than the timeout value; libuv's cached loop clock is now refreshed before arming the timer. [#33935](https://github.com/oven-sh/bun/pull/33935)
- A failed `Bun.spawn()` (e.g. `ENOENT`) on Windows leaves later spawn calls unaffected.
- Pausing and resuming a pipe from inside its own read callback (the path `child_process` stdio backpressure takes) is safe on Windows, via a libuv upgrade.
- **`Bun.spawn()`**: `Bun.file(path)` and `Bun.file(fd)` work at `stdio[3]` and higher.
- **`Bun.spawn()`**: on Windows, an async-iterable `stdin` completes after the child exits.
- **`Bun.spawn()`**: `maxBuffer` stays enforced after the `.stdout`/`.stderr` stream getters are accessed. [#34349](https://github.com/oven-sh/bun/pull/34349)
- **`Bun.spawn()`**: stdout/stderr pipes are closed after a timeout kill so buffered reads don't hang. [#35012](https://github.com/oven-sh/bun/pull/35012)
- **`Bun.spawn()`**: Windows child processes can now set `CREATE_BREAKAWAY_FROM_JOB` under Bun's no-orphans job object. [#36414](https://github.com/oven-sh/bun/pull/36414)

### Windows

- `bun:ffi` now works on Windows ARM64, after fixing a TinyCC arm64 codegen bug where LLP64's 32-bit `long` truncated an immediate-operand mask and corrupted every double and pointer crossing the FFI boundary. [#33696](https://github.com/oven-sh/bun/pull/33696)
- `dlopen()` accepts non-ASCII library paths on Windows, so DLLs under a profile directory with a non-English username load. [#33712](https://github.com/oven-sh/bun/pull/33712)
- On Windows, `bun ./dist/**/*.html` now registers subdirectory routes with forward slashes; previously `/components/buttons` 404'd because the route was stored as `/components\buttons`. [#36532](https://github.com/oven-sh/bun/pull/36532)
- The `Response(Bun.file(path))` streaming path on Windows closes its file descriptor exactly once.
- `fs.rm(..., { recursive: true })` on Windows handles readonly files and files held by antivirus or cloud-sync software.
- Unrecognized Windows error codes now map to the same errno values Node.js returns.
- The Windows `bun run`/`bunx` fast path now heap-allocates its environment block instead of using a fixed 32,767-character buffer, so it no longer bails to the slow path when the process environment exceeds 32 KB (common in CI).
- `bun getcompletes` now works on Windows, so tab completion can be installed on every platform. [#24620](https://github.com/oven-sh/bun/pull/24620)
- **`--compile` on Windows**: the emitted `.exe` now carries a valid PE `OptionalHeader.CheckSum`.
- **`--compile` on Windows**: the emitted `.exe` is truncated to the correct length (orphaned Authenticode bytes from the base binary were being left past the last section).
- Fixed `bun build --compile` dropping the `[dir]` prefix from `Bun.embeddedFiles[].name` under a path-preserving asset naming pattern. [#31576](https://github.com/oven-sh/bun/pull/31576)
- Fixed ENOENT reading nested embedded assets on Windows. [#31576](https://github.com/oven-sh/bun/pull/31576)
- **Sourcemaps**: original columns are no longer off by one on lines containing a non-ASCII character.
- **Sourcemaps**: `sources` paths on Windows use forward slashes so DevTools resolves them.
- **Sourcemaps**: source files ending in an incomplete multi-byte UTF-8 sequence are handled.
- **[`node:net`](https://nodejs.org/api/net.html)**: sockets no longer close before buffered inbound data is read. [#36332](https://github.com/oven-sh/bun/pull/36332)
- **[`node:net`](https://nodejs.org/api/net.html)**: `SO_REUSEADDR` is set when binding `localPort` on outgoing connections on non-Windows platforms. [#33886](https://github.com/oven-sh/bun/pull/33886)
- **[`node:net`](https://nodejs.org/api/net.html)**: `server.unref()` releases Windows named-pipe listeners. [#37079](https://github.com/oven-sh/bun/pull/37079)
- **[`node:net`](https://nodejs.org/api/net.html)**: a `ReferenceError` in the happy-eyeballs path with `localPort` set is fixed. [#30699](https://github.com/oven-sh/bun/pull/30699)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: coverage of Node's suite reaches **97.5%** with `Utf8Stream` support and unified Windows errno mapping. [#34505](https://github.com/oven-sh/bun/pull/34505)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: Leaked `fs.promises` `FileHandle` descriptors are closed on GC with `ERR_INVALID_STATE`. [#33693](https://github.com/oven-sh/bun/pull/33693)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: `fs.writev`/`readv` chunk more than `IOV_MAX` buffers. [#33695](https://github.com/oven-sh/bun/pull/33695)
- **[`node:fs`](https://nodejs.org/api/fs.html)**: paths of exactly `MAX_PATH_BYTES` are rejected with `ENAMETOOLONG`. [#34091](https://github.com/oven-sh/bun/pull/34091)
- **[`node:path`](https://nodejs.org/api/path.html)**: `path.win32.resolve` fixed for drive-relative paths on Windows.
- **[`node:path`](https://nodejs.org/api/path.html)**: `path.win32.relative()` handles slash-rooted prefix inputs.
- `fs.watch` now emits `('change', null)` to every live watcher when the kernel's event queue overflows on Linux or Windows, instead of silently dropping the loss signal.
- **`bunx` on Windows** now correctly handles empty-string arguments, quoted arguments containing spaces, and package names containing multi-byte UTF-8 characters.
- **Windows ARM64**: the `node_modules/.bin` shim executable is now compiled natively for aarch64, so package binaries no longer launch through x64 emulation. [#27448](https://github.com/oven-sh/bun/pull/27448)
- **Native-binary postinstall skipping** now applies to nested copies of a `nativeDependencies` package (a second esbuild pinned under `drizzle-kit/node_modules/`), not just the hoisted one. [#36495](https://github.com/oven-sh/bun/pull/36495)
- **Native-binary postinstall skipping**: Windows now takes the same `.bin` → platform-binary redirect path as POSIX. [#36856](https://github.com/oven-sh/bun/pull/36856)
- **Isolated store directory names** now sanitize `?` in tarball URLs, so a package installed from a URL with a query string can be imported (and installs on Windows, where `?` is an invalid filename character). [#36989](https://github.com/oven-sh/bun/pull/36989)
- **BoringSSL on macOS and Windows**: [now allocates through mimalloc](https://github.com/oven-sh/bun/pull/34847). The `OPENSSL_memory_*` override hooks were compiled out on non-ELF targets, so every TLS record read hit the system allocator.
- **Startup memory on Windows**: JavaScriptCore's 128MB compact-heap reservation is now [lazily committed](https://github.com/oven-sh/bun/pull/29294), so only the ~3–8MB actually used counts toward committed memory.
- **[`node:http`](https://nodejs.org/api/http.html)** On Windows, the server now stops reading the socket while a request body is paused (`req.pause()`, or a handler that never reads `req`), applying backpressure to the client.
- Fixed a memory leak on Windows (one `StaticPipeWriter` per spawn) when a buffer `stdin` finishes writing. [#35297](https://github.com/oven-sh/bun/pull/35297) [#35150](https://github.com/oven-sh/bun/pull/35150) [#35107](https://github.com/oven-sh/bun/pull/35107)
- Fixed a crash at thread teardown or in `free` on Linux and Windows for threads that had used a private mimalloc heap, which includes `Worker` threads; fixed by resyncing Bun's mimalloc fork with upstream.
- `fs.watch()` on Windows cleans up its internal path map when a watch fails, so retrying the same path (as Vite, NestJS CLI, chokidar, and watchpack do) works.
- **`Buffer.indexOf` / `lastIndexOf`**: [worst case is now O(n+m)](https://github.com/oven-sh/bun/pull/36420). A rare-byte two-anchor SIMD prefilter backed by a Two-Way fallback replaces the first-byte-only scan; a `lastIndexOf` over a 4 MB `aaa…` haystack with a 4000-byte adversarial needle drops from 7.4 s to under 1 ms (Node: 19 ms). About 250 byte- and substring-search sites in the runtime now [call the Highway kernel directly](https://github.com/oven-sh/bun/pull/37052), including on [Windows](https://github.com/oven-sh/bun/pull/34820).
- **`Bun.Glob` on Windows**: up to [2.39x faster](https://github.com/oven-sh/bun/pull/28489) for non-`**` patterns. The current pattern component is passed as a kernel-side `FileName` filter to `NtQueryDirectoryFile`, so non-matching entries never reach userspace.
- **Internal rough-tick clock**: sub-µs everywhere, backed by the CPU timestamp counter on x64 and ARM64. The old ~15.6 ms `GetTickCount64` floor on Windows is gone. [#29806](https://github.com/oven-sh/bun/pull/29806)
- Linux and Windows builds now bundle ICU 78.3 (up from 75.1 and 73.2), so `Intl` uses newer locale data.
- On Windows, `bun run --filter` now kills the full descendant process tree on Ctrl+C, so grandchild dev servers spawned through `.cmd` shims or `cmd.exe` no longer survive with their ports still bound. [#36291](https://github.com/oven-sh/bun/pull/36291)
- On Windows, `net.connect()` failures now surface the real error code (`EADDRINUSE`, `ECONNRESET`) instead of reporting `ECONNREFUSED` (or `ENOENT` for a path connect) for every failure. [#36786](https://github.com/oven-sh/bun/pull/36786)
- On Windows, `fs.mkdir(dir, { recursive: true })` no longer throws `EEXIST` when the directory already exists with the ReadOnly attribute set, which OneDrive applies to synced folders. [#34416](https://github.com/oven-sh/bun/pull/34416)
- Fixed a hang where `await proc.exited` after `proc.unref()` (or an `AbortSignal.timeout()` under `bun test`) busy-spun forever because libuv's `uv_run(UV_RUN_NOWAIT)` skipped its IOCP poll with only unref'd handles alive.
- Fixed a CRT fd leak in `fstat`/`futimens` on `NtCreateFile`-backed handles (`Bun.Image(path)`, `bun pm pack`, `bun create`) that drifted long-running processes into `EMFILE` after ~8,189 calls. [#33713](https://github.com/oven-sh/bun/pull/33713)
- Fixed `NtCreateFile` opens with `O_NOFOLLOW` dropping `FILE_SYNCHRONOUS_IO_NONALERT`, a latent bug with no JS-reachable path today. [#36193](https://github.com/oven-sh/bun/pull/36193)
- Reading and writing files larger than 4GB works on Windows.
- Reparse points are classified by tag so only name surrogates are followed as symlinks
- Opening files with `O_TRUNC` truncates correctly regardless of access mode
- `process.dlopen` returns an error for over-length paths
- `Bun.write()` reports an error when the source file does not exist
- Socket polling setup handles `uv_poll_init_socket` failure
- Native addons using SEH no longer have first-chance exceptions hijacked by Bun's crash handler
- **`--linker=isolated` on Windows** now falls back to junctions when symlink creation fails with an unrecognized Windows error (typically from security software or certain filesystems), instead of silently succeeding with missing package links. [#32643](https://github.com/oven-sh/bun/pull/32643)
- **`bun pm pack --quiet`** no longer prints a leading newline before the tarball name, so `$(bun pm pack --quiet)` captures a clean filename. [#32751](https://github.com/oven-sh/bun/pull/32751)
- **`bun pm pack`** `--destination` on Windows no longer prints a mixed-separator path. [#32751](https://github.com/oven-sh/bun/pull/32751)

### Other performance improvements

- **macOS DNS**: [`dns.lookup()` no longer parks one thread per in-flight query](https://github.com/oven-sh/bun/pull/36619). Rewritten on `DNSServiceGetAddrInfo` over a shared connection to mDNSResponder; 500 concurrent lookups stay at ~9 threads instead of spiking to 513.
- **`fs.copyFile` / `Bun.write(file, file)` read/write fallback**: when `clonefile`/`copy_file_range`/`sendfile` aren't available, the source is hinted `POSIX_FADV_SEQUENTIAL` so the kernel doubles its readahead: up to 1.39× faster on the 32 KiB inner loop from a cold cache (~1.2× end-to-end for small files); the >1 MiB slab path is unchanged. [#34825](https://github.com/oven-sh/bun/pull/34825)
- **`url.searchParams.append()`**: fixed an O(N²) reserialize-on-every-mutation; 4000 appends took 2–5 s before and now take under 1 ms, within noise of a detached `URLSearchParams`. The URL's href is now rebuilt lazily on the next read. [#35080](https://github.com/oven-sh/bun/pull/35080)
- **Timer GC sweep**: fixed an O(n²) ordered-map remove when many timers had their numeric id read (`+t`, `` `${t}` ``); sweeping 30,000 such timers drops from seconds to ~2 ms. [#35077](https://github.com/oven-sh/bun/pull/35077)
- **`bun install --minimum-release-age` / `bun outdated`**: npm-manifest `time` entries are indexed in one O(V) pass instead of an O(V²) linear scan per version; packages with thousands of versions like typescript no longer pay millions of comparisons per cold resolve. [#34543](https://github.com/oven-sh/bun/pull/34543)
- **`bun build` cross-chunk export aliasing**: fixed an O(N²) restart-from-1 probe loop; a shared chunk with 20,000 same-name exports builds in 424 ms instead of 17.3 s. [#34529](https://github.com/oven-sh/bun/pull/34529)
- **`Bun.Glob` brace groups**: skipping to the end of a group is now O(1) via a cached close-`}` index; a ~300 KB `{*,*,…,*}b` pattern that took ~5 s per `match()` now completes instantly. [#36407](https://github.com/oven-sh/bun/pull/36407)
- **`Response.json()`**: [~3.5x faster](https://github.com/oven-sh/bun/pull/25717). Bun was accidentally passing `0` instead of `undefined` for the indent argument, knocking JavaScriptCore out of its SIMD-accelerated FastStringifier path.
- **`Buffer.toString("hex")`**: [up to ~1.8x faster](https://github.com/oven-sh/bun/pull/31421) than Bun 1.3.14 (1.2–1.5x on 64 KB–1 MB buffers), now backed by a Highway SIMD kernel instead of a scalar table loop.
- `Buffer.toString("base64")`/`"base64url"` on 32–128 KB buffers are ~20–30% faster now that the output string is allocated through a cheaper path.
- **`path.parse()`**: [~2.2–2.8x faster](https://github.com/oven-sh/bun/pull/26865) for typical paths and ~7x faster for empty strings. Bun caches a pre-built Structure for `{root, dir, base, ext, name}` and writes property values by offset instead of triggering five shape transitions per call.
- **`Bun.hash.xxHash3`**: [~2.5x faster](https://github.com/oven-sh/bun/pull/31491) on AVX-512 hardware for the `-baseline` build, ~1.2x for the AVX2 build — the stripe loop now runtime-dispatches to the widest SIMD available.
- **`TextEncoder.encode`**: up to [~1.6x faster](https://github.com/oven-sh/bun/pull/31385) on ASCII strings of a few hundred bytes and up. The leading ASCII run is now scanned and copied in a single SIMD pass, and a redundant 2 KB stack zero-fill on every call is gone.
- **`Buffer.slice()` / `Buffer.subarray()`**: [~1.5–1.7x faster](https://github.com/oven-sh/bun/pull/26819) across all cases. Moved from a JS builtin to native C++ with an int32 fast path that skips `toNumber()` coercion.
- **`bun build` on 2-core machines**: [~1.3–1.4x faster](https://github.com/oven-sh/bun/pull/28940). A CAS bug in `ThreadPool.warm()` meant worker threads were never actually pre-spawned, so the bundler ran with one fewer real thread than configured.
- **`expect().toContain()`**: [~2x faster](https://github.com/oven-sh/bun/pull/29104), `toBeOneOf()` ~1.3x faster. `JSArrayIterator` reads directly from contiguous array storage instead of calling `getIndex()` per element.
- **ESM module loading**: [~12% faster](https://github.com/oven-sh/bun/pull/29948). A one-character fix in the parser stops copying an 8 KB allocator struct on every AST node creation; `_platform_memmove` dropped from 7.5% to 2.9% of self time.
- **Async HTTP handlers that interleave**: [stay on the corked fast path](https://github.com/oven-sh/bun/pull/28615). Bun keeps two independent cork buffers per event loop, so a resumed handler can batch its writes even when another request is mid-flight.
- **`structuredClone()` of dense arrays**: [`memcpy` fast path](https://github.com/oven-sh/bun/pull/26814). Int32 and Double arrays clone with a single `memcpy` of their backing storage, and contiguous arrays of primitives skip the byte-stream serializer entirely.
- **`structuredClone()` of arrays of flat objects**: [Structure-cache fast path](https://github.com/oven-sh/bun/pull/26818). The shape of the first element is reused for every subsequent same-shaped element, skipping all property transitions during deserialization.
- **`Bun.Glob.scan()` with multiple `**`**: [visits each directory once](https://github.com/oven-sh/bun/pull/28496). Patterns like `**/node_modules/**/\*.js`no longer fork the traversal at every`\*\*/X` boundary; the walker carries an NFA state set instead.
- **`Bun.stringWidth`**: [SIMD throughout](https://github.com/oven-sh/bun/pull/28767). We scan ASCII runs 64 bytes at a time and skip ANSI escape sequences (terminal hyperlinks, colors) vector-wide instead of byte by byte.
- **`Bun.escapeHTML`**: [zero-allocation when nothing to escape](https://github.com/oven-sh/bun/pull/31483). Rewritten as a Highway SIMD binding that returns the input `JSString` unchanged when clean, and computes exact output length in one pass before a single table-driven fill.
- **Compile-time string maps**: [no runtime hashing](https://github.com/oven-sh/bun/pull/31875). Static string lookups throughout the runtime use length-dispatched jump tables and constant word-sized compares; lexer keywords and HTTP method names resolve without a hash round.
- **`Bun.hash.crc32()`**: [20–100x faster](https://github.com/oven-sh/bun/pull/25692) on 1MB inputs (2.3 ms → 18 µs on an AVX-512 x64 machine). Now uses zlib's hardware-accelerated implementation (PCLMULQDQ on x86, CRC32 instructions on ARM) instead of a software-only loop.
- **`Buffer.from(array)`**: [up to ~2x faster](https://github.com/oven-sh/bun/pull/26135) for small plain JS arrays. Skips `JSC::construct()` overhead and hits JavaScriptCore's bulk-copy fast path for Int32/Double-shaped arrays.
- **JSON-mode IPC**: fixed an [O(n²) hot loop](https://github.com/oven-sh/bun/pull/25743) when large messages arrive in chunks. Each byte is now scanned exactly once; a 100 MB message from a `node` child arrives in 0.5 s instead of 1.2 s.
- **`tls.getCACertificates('system')` on macOS**: [~10s → ~50ms](https://github.com/oven-sh/bun/pull/30323) on managed Macs. No longer triggers per-certificate OCSP/CRL network fetches when enumerating the keychain.
- **`setImmediate` on Linux/macOS**: [no longer writes to the eventfd on every iteration](https://github.com/oven-sh/bun/pull/26821). strace shows ~44k eventfd writes for a 5s `setImmediate` loop dropping to 0.
- **Event loop on Linux**: now uses [edge-triggered epoll for eventfd wakeups](https://github.com/oven-sh/bun/pull/26815), eliminating an unnecessary `read()` syscall on every loop tick.
- **Event loop under load**: now [drains epoll/kqueue in a tight loop](https://github.com/oven-sh/bun/pull/28823) when more than 1024 fds become ready at once, so one tick can service the whole backlog instead of one 1024-event batch.
- **Module resolver**: [caches not-found results](https://github.com/oven-sh/bun/pull/23505) to skip repeated `stat`/`openat` syscalls for the same missing path during import resolution ([part 2](https://github.com/oven-sh/bun/pull/23506)).
- **Enum-string getters**: `request.cache`, `response.type`, `ws.binaryType`, `socket.localFamily`, and friends now [return cached atom-backed strings](https://github.com/oven-sh/bun/pull/30173) instead of allocating on every access.
- **`bun build --compile`**: embedded `.node` addons are [extracted once to a content-hashed file](https://github.com/oven-sh/bun/pull/29587) in the temp dir and reused across `dlopen()` calls, Workers, and restarts, instead of writing a new copy per load.
- **Incremental GC**: ~60 generated JS classes (`Request`, `Response`, `Stats`, `Dirent`, `Subprocess`, …) [no longer enroll in JSC's output-constraint GC pass](https://github.com/oven-sh/bun/pull/29532). Every edge they expose already fires a write barrier, so the per-mutator-yield rescan was pure overhead.
- **`structuredClone()`**: the dense-number-array fast path [no longer zero-fills the destination](https://github.com/oven-sh/bun/pull/26989) before copying into it.
- **`AbortSignal.abort()`**: [~6% faster](https://github.com/oven-sh/bun/pull/26686) when no listeners are registered. Skips allocating and dispatching the Event entirely.
- Removed an [unnecessary `getcwd()` syscall](https://github.com/oven-sh/bun/pull/27967) from `fs.watch()`.
- Fixed an [operator-precedence bug](https://github.com/oven-sh/bun/pull/27966) in the native-readable stream's `getRemainingChunk` that was triggering an unnecessary `Buffer.alloc` on nearly every chunk.
- Dozens of hot-path micro-optimizations across the runtime: redundant allocations and copies removed from [`response.statusText`](https://github.com/oven-sh/bun/pull/31038), [`hash.digest('base64')`](https://github.com/oven-sh/bun/pull/31037), [`server.fetch(url)`](https://github.com/oven-sh/bun/pull/31062), [`fetch()` with a custom `Host` header](https://github.com/oven-sh/bun/pull/31066), [`package.json` `"exports"` resolution](https://github.com/oven-sh/bun/pull/31036), and the runtime transpiler cache ([#31054](https://github.com/oven-sh/bun/pull/31054), [#31064](https://github.com/oven-sh/bun/pull/31064)).
- **Rejected-promise drain**: draining the rejected-promise list at each macrotask checkpoint is now O(n) instead of O(n²); rejecting 20,000 promises in one tick drops from 19.13 ms to 0.88 ms. [#32554](https://github.com/oven-sh/bun/pull/32554)
- **`Bun.indexOfLine()`**: fixed an O(n²) scan when the buffer contained any non-ASCII byte; a 60 KB buffer with a single `é` before the newline now scans in ~0.01 ms instead of ~15 ms. [#32732](https://github.com/oven-sh/bun/pull/32732)
- **Recursive `fs.cp` on macOS**: once again uses a single whole-tree `clonefile()` when the source contains only regular files and directories and the destination doesn't exist, restoring the fast path lost when Node's relative-symlink rewriting was ported. [#32503](https://github.com/oven-sh/bun/pull/32503)
- **`FileSystemRouter` URL joins**: skip zero-filling two 2 KB stack scratch buffers per join, saving 4 KB of memset per emitted URL in the router and dev server. [#32393](https://github.com/oven-sh/bun/pull/32393)
- `bun install` now explains that an unsupported `bun.lock` version was likely written by a newer Bun and suggests running `bun upgrade`, instead of a bare "Unknown lockfile version" error. [#32465](https://github.com/oven-sh/bun/pull/32465)
- Error messages for `bun install --linker`, `bun build --format`/`--loader`/`--define`, `bun patch` with no argument, and `bun run --filter` on an unreadable workspace `package.json` now echo the offending value and/or show a correct example. [#32470](https://github.com/oven-sh/bun/pull/32470)
- `bun init` now scaffolds every template (blank, library, and all React variants) with TypeScript 7. [#33265](https://github.com/oven-sh/bun/pull/33265)
- The `bun init` template lockfiles have been regenerated so `bun install --frozen-lockfile` passes out of the box. [#33265](https://github.com/oven-sh/bun/pull/33265)
- **ESM imports of builtins**: `import` of `node:fs`, `node:tls`, `node:http`, `node:timers`, and the other builtins with lazily computed exports no longer computes those exports at import time; each is computed when something first binds to it. Plain data exports are still snapshotted at import. `import "node:fs"` was pulling in the whole `node:stream` stack for `ReadStream` and `WriteStream`, taking 13.3 ms where `require("node:fs")` took 7.8 ms. [#37525](https://github.com/oven-sh/bun/pull/37525)
- **`export * from "bun"`**: re-exporting the `bun` module, or loading it through `import()` with a computed specifier, no longer constructs all 115 `Bun.*` properties up front; each is constructed when first bound. One consequence: an invalid `REDIS_URL` now throws when the `redis` export is first used, and the rest of the module loads. [#37714](https://github.com/oven-sh/bun/pull/37714)
- **`node:process` and `node:module`**: both now construct only the exports a file imports. `import process from "node:process"` no longer builds `stdout`, `stderr`, and `stdin` or loads `node:tty` and `node:stream` for them, which was adding 10–18 ms to the startup of an otherwise empty file; `import { createRequire } from "node:module"` constructs only `createRequire`. [#37726](https://github.com/oven-sh/bun/pull/37726)

### Bug fixes

We fixed over 2,900 issues since Bun 1.3. Many were found through continuous fuzzing of runtime APIs with Fuzzilli, coverage-guided fuzzing of system calls and parsers, AddressSanitizer in CI, LeakSanitizer in CI, and a continuously-running Claude Code session fuzzing Bun canary's outputs against Bun v1.3.14 and Node.js.

- **`bun build --compile`**: Linux standalone executables run on WSL1. The `.bun` payload is now embedded inside an existing segment of the binary instead of adding a new one, a layout WSL1's program loader rejects. [#29967](https://github.com/oven-sh/bun/pull/29967)
- `path.resolve`, `path.relative`, and `path.toNamespacedPath` handle arbitrarily long paths.
- The timer behind `Atomics.waitAsync` is thread-safe.
- Async zstd compression, `crypto.scrypt`, and `Bun.Transpiler` keep their input buffers alive for the duration of the operation.
- Fixed `Request.formData()` truncating small binary file uploads at the first null byte, so a 4-byte gzip header would come back as 3 bytes.
- Fixed `process.env` being completely empty when the current working directory lacks read permission (common in locked-down containers). [#28785](https://github.com/oven-sh/bun/pull/28785)
- Bun now starts on older Linux kernels (< 3.17, e.g. Synology NAS) that lack the `getrandom()` syscall. [#27282](https://github.com/oven-sh/bun/pull/27282)
- Bun no longer returns `EINVAL` on socket reads under gVisor (Google Cloud Run). [#27390](https://github.com/oven-sh/bun/pull/27390)
- Fixed piping Bun's output into `less`, `fzf`, and `fx`. Bun was clobbering the downstream program's raw mode at exit, leaving it unresponsive to keypresses. [#29593](https://github.com/oven-sh/bun/pull/29593)
- Fixed `Bun.Glob` and `fs.readdir({ recursive: true })` silently skipping files on bind mounts, FUSE, NFS, and similar filesystems. [#25838](https://github.com/oven-sh/bun/pull/25838)
- The Linux file watcher handles large batches of inotify events.
- Fixed `bun --hot` on macOS losing track of files after editors performed atomic write-then-rename saves, causing the module graph to flip between old and new code. [#29529](https://github.com/oven-sh/bun/pull/29529)
- Bun's HTTP server handles absolute-form request URLs on keep-alive connections.
- Fixed Bun's DNS cache never expiring stale entries while any in-flight request to that host held a reference, so DNS results never refreshed under sustained traffic. [#28271](https://github.com/oven-sh/bun/pull/28271)
- Fixed `require()` of an ES module deadlocking when the module graph contained a diamond dependency through a barrel file. [#30527](https://github.com/oven-sh/bun/pull/30527)
- Deeply nested expressions and JSX throw a catchable error in `bun build` and the dev server.
- **`Bun.S3Client`**: fixed a leak when a download stream is cancelled while the socket is idle. [#32608](https://github.com/oven-sh/bun/pull/32608)
- **`Bun.S3Client`**: a `Content-Length: 0` + `Connection: close` response (the shape of every S3 PUT/DELETE) is no longer misreported as `ConnectionClosed`, fixing spurious retries through connection-recycling proxies. [#33292](https://github.com/oven-sh/bun/pull/33292)
- **`Bun.Glob`**: explicitly-named dotfile segments match without `dot: true`, matching bash and fast-glob.
- **`Bun.Glob`**: literal segments resolve through symlinked directories without `followSymlinks: true`, matching bash and fast-glob.
- **`Bun.Glob`**: `absolute: true` reports `ENAMETOOLONG` for over-long paths.
- **`Bun.Glob`**: deeply nested braces are handled.
- **`Bun.color()`**: 24-bit `number` inputs like `0xff0000` are treated as opaque instead of alpha 0.
- **`Bun.color()`**: `ansi-16` output emits the color number as decimal digits instead of a raw control byte.
- **`Bun.color()`**: `ansi-256` no longer underflows the grey ramp.
- **`Bun.color()`**: `hsl`/`lab` output is parseable.
- **`Bun.color()`**: `lab()`/`oklab()` on the sRGB gamut boundary no longer desaturate in their sRGB fallback.
- **`Bun.Cookie`**: `Expires` serializes as a valid RFC 6265 date (previously every date had the wrong weekday, an unpadded day, and `-0000` instead of `GMT`). [#32926](https://github.com/oven-sh/bun/pull/32926)
- **`Bun.Cookie`**: `parse()` records both `Expires` and `Max-Age` regardless of order. [#33393](https://github.com/oven-sh/bun/pull/33393)
- **`Bun.Cookie`**: `isExpired()` applies the RFC 6265 precedence rule. [#33393](https://github.com/oven-sh/bun/pull/33393)
- **`Bun.YAML`**: `parse()` combines `\uD8xx\uDCxx` surrogate-pair escapes so JSON documents containing emoji parse correctly. [#32731](https://github.com/oven-sh/bun/pull/32731)
- **`Bun.YAML`**: `stringify()` no longer emits `\L`/`\P` for U+00A8/U+00A9. [#32718](https://github.com/oven-sh/bun/pull/32718)
- **`HTMLRewriter`**: `element.getAttribute()` returns `""` for present-but-empty attributes (including boolean attributes like `disabled`) instead of `null`. [#32840](https://github.com/oven-sh/bun/pull/32840)
- **`HTMLRewriter`**: `setAttribute`/`removeAttribute` throw on invalid arguments instead of returning an `Error` object. [#32840](https://github.com/oven-sh/bun/pull/32840)
- **`bun:sqlite`**: generic errors (syntax errors, unknown tables, unknown columns) set `error.code` to `"SQLITE_ERROR"` instead of `undefined`, matching better-sqlite3. [#33397](https://github.com/oven-sh/bun/pull/33397)
- **`Bun.stringWidth()`**: bidi controls (U+202A–U+202E, U+2066–U+2069, U+061C) and Mongolian variation selectors are now zero-width, matching `wcwidth(3)` and the `string-width` package. [#33049](https://github.com/oven-sh/bun/pull/33049)
- `Bun.JSON5.parse`, `Bun.JSONC.parse`, `Bun.TOML.parse`, `Bun.YAML.parse`, and the `Bun.markdown` renderers throw `ERR_OUT_OF_RANGE` on oversized inputs.
- Sockets with pending writes are torn down cleanly on peer reset on macOS.
- Fixed `fetch()` hanging at 100% CPU when a `node:stream` `Readable` whose `_read()` pushes synchronously was passed as the request body. [#36087](https://github.com/oven-sh/bun/pull/36087)
- Fixed `node:https` server truncating large response bodies when the client half-closed the connection before Bun had finished flushing its buffered TLS writes. [#35109](https://github.com/oven-sh/bun/pull/35109)
- Fixed `process.setuid()`, `process.seteuid()`, and related identity calls deadlocking on Linux. [#33565](https://github.com/oven-sh/bun/pull/33565)
- Fixed nested `bun run` exiting before its child on Ctrl-C — the signal-forwarding handler now stays installed across deliveries, so `bun run` waits for the script's cleanup to finish. [#36711](https://github.com/oven-sh/bun/pull/36711)
- The epoll_pwait fallback no longer busy-spins on sub-millisecond timers. [#34779](https://github.com/oven-sh/bun/pull/34779) [#34780](https://github.com/oven-sh/bun/pull/34780)
- epoll/kqueue waits now subtract elapsed time when retrying after EINTR instead of over-waiting. [#34779](https://github.com/oven-sh/bun/pull/34779) [#34780](https://github.com/oven-sh/bun/pull/34780)
- Loading a glibc-linked native addon on musl-based Linux now throws `ERR_DLOPEN_FAILED` instead of segfaulting.
- Restored the Izenpe.com root CA to the bundled certificate store; a bug in the cert-bundling script had accidentally dropped it. [#31612](https://github.com/oven-sh/bun/pull/31612)
- Fixed a crash when aborting a `fetch()` after its response body stream had been garbage collected.
- Comma-separated `Connection`, `Transfer-Encoding`, `Content-Encoding`, and `Upgrade` headers are now parsed as token lists. [#36777](https://github.com/oven-sh/bun/pull/36777) [#36370](https://github.com/oven-sh/bun/pull/36370) [#34425](https://github.com/oven-sh/bun/pull/34425) [#36588](https://github.com/oven-sh/bun/pull/36588)
- File-response streams tear down cleanly on read errors.
- **Sockets**: TLS sockets now FIN the TCP write side after `SSL_shutdown` completes on half-open connections.
- **Sockets**: UDP sockets stop dispatching batched packets once `close()` is called from a data handler.
- **Sockets**: connecting to over-long Unix socket paths on Linux returns an error.
- **DNS**: `dns.Resolver` no longer keeps the event loop alive for an extra retransmit interval after its last query completes via c-ares timeout. [#36192](https://github.com/oven-sh/bun/pull/36192)
- **DNS**: fixed a `FilePoll` slot leak per distinct-hostname libinfo lookup (`fetch`, `Bun.connect`, WebSocket, QUIC) on macOS. [#34423](https://github.com/oven-sh/bun/pull/34423)
- **DNS**: fixed a memory leak of pending-lookup hostnames when the resolver pool is dropped. [#33901](https://github.com/oven-sh/bun/pull/33901)
- **`Worker` termination**: fixed several crashes when `worker.terminate()` ran while sockets, WebSockets, CJS `require`, `process.emit`, `fs.readFile`, or DNS lookups were in flight.
- **`Bun.file()`**: fixed an fd leak on POSIX when an abandoned `.stream()` reader is garbage-collected. [#35211](https://github.com/oven-sh/bun/pull/35211)
- **Module resolver**: fixed a bug in `tsconfig` `paths` wildcard resolution when the pattern's prefix and suffix overlap.
- **Module loading**: importing a long `data:` URL no longer fails with `ENAMETOOLONG`. [#37157](https://github.com/oven-sh/bun/pull/37157)
- **Module loading**: CSS imports at runtime now default-export `{}`, matching `bun build` behavior. [#35163](https://github.com/oven-sh/bun/pull/35163)
- **Parser**: JS, TS, and TOML error columns now count UTF-16 code units, so editors jump to the right column. [#34720](https://github.com/oven-sh/bun/pull/34720)
- **Parser**: error locations are correct for rest-with-default and parenthesized destructuring pattern syntax errors. [#35970](https://github.com/oven-sh/bun/pull/35970)
- `ResolveMessage` `.message`, `.specifier`, and `.referrer` render non-ASCII paths correctly. [#34096](https://github.com/oven-sh/bun/pull/34096)
- **Parser**: deeply nested TOML throws `RangeError`.
- **Parser**: the sourcemap parser rejects malformed VLQ fields with a proper error.
- **Parser**: the CSS parser reports custom at-rule block parse errors.
- **`structuredClone`**: malformed `Set`, `Map`, and `RegExp` payloads are rejected.
- Duplex-wrap origin/listeners are now GC-rooted via the JS wrapper instead of Strong handles (rooting-model cleanup, not a leak). [#34672](https://github.com/oven-sh/bun/pull/34672)
- **`HTMLRewriter`**: abandoned transforms are collected safely.
- Process exit and worker termination are safe while an off-thread transform is in flight.
- **`bun build --compile`**: inject temp files use random names to avoid cross-process collisions.
- **`bun build --compile`**: single-file executables validate the Mach-O `__BUN` segment size.
- **`Bun.plugin`**: an object-loader `exports` getter that throws is handled.
- `WebAssembly.instantiateStreaming` accepts `application/wasm` regardless of `Content-Type` letter case. [#33229](https://github.com/oven-sh/bun/pull/33229)
- `multipart/form-data` parsing matches `form-data` case-insensitively and accepts HTAB whitespace. [#34362](https://github.com/oven-sh/bun/pull/34362)
- Oversized strings throw `ERR_STRING_TOO_LONG`.
- `--cpu-prof-dir` and `--heap-prof-dir` report an error on over-long paths.
- `Bun.JSONC.parse` throws `SyntaxError` on invalid input instead of a `BuildMessage`.
- bunfig.toml type-mismatch errors print human-readable type names.
- `Error.stack` computation, `Blob` content-type handling, and deserialized `Blob` `lastModified` are hardened.
- `node:vm` `link()`, `Worker` `name`, and FFI threadsafe callbacks are hardened.
- Sliced `Bun.file()` reads respect the slice bounds.
- `process.stdin` no longer ignores `highWaterMark` backpressure when reading from a pipe.
- The file watcher returns an error when its thread fails to spawn.
- Nested `${...}` inside `${VAR:-default}` in `.env` files parses correctly.
- Native `SIGABRT` and `SIGTRAP` crashes now produce Bun crash reports.
- Heap snapshots report `module.children` and `module._compile` for better memory debugging.
- `bun create` no longer busy-waits on git operations.
- `Bun.sliceAnsi` returns the ellipsis when a start-cut range contains only zero-width clusters.
- **TLS sockets**: the handshake idles correctly while waiting on the peer.
- **Module resolver**: over-long `package.json` `browser` map keys are handled; the package loads and the other entries in the map still apply.
- **`file:../` paths in `overrides` and `resolutions`** are no longer rejected with "unsafe folder path"; paths declared in the root `package.json` are trusted the same as direct dependencies. [#32452](https://github.com/oven-sh/bun/pull/32452)
- **Transitive `file:` dependencies** of a local `file:` package are now linked into `node_modules` under the hoisted linker, fixing `Cannot find module` at runtime for the nested package. [#33159](https://github.com/oven-sh/bun/pull/33159)
- **Lockfile migration** from `package-lock.json` and `pnpm-lock.yaml` no longer silently drops `file:` dependencies whose `os`/`cpu` fields don't match the host. [#33155](https://github.com/oven-sh/bun/pull/33155)
- **The isolated linker** no longer leaves `node_modules/.bun` symlinked to the shared global store after `install.globalStore` is disabled. [#32182](https://github.com/oven-sh/bun/pull/32182)
- **The isolated linker**: ranged peer dependencies loaded from `bun.lock` now resolve to the same version on the second install as the first. [#32182](https://github.com/oven-sh/bun/pull/32182)
- **`bun pm pkg set`** no longer writes a garbage property key into `package.json` when the key path contains a bracketed index like `contributors[0]=alice`. [#33186](https://github.com/oven-sh/bun/pull/33186)
- **Registry request retries** follow 3xx redirects to the correct URL.
- **Registry request retries**: a retry after a cross-origin redirect keeps its `Authorization` header.
- **`patchedDependencies`** entries with malformed hunks are handled by `bun install`.
- **Error message formatting**: several `bun install` error paths no longer leak raw markup tags (`Integrity check failed<r> for tarball`) into terminal output. [#33245](https://github.com/oven-sh/bun/pull/33245)
- A crash in the HTTP client in request-failure handling has been fixed.
- **`Bun.YAML.stringify()`, `Bun.TOML.stringify()`, `Bun.JSON5.stringify()`**: a boxed `String` or `Number` whose `Symbol.toPrimitive`, `valueOf`, or `toString` throws now surfaces that exception; previously it was dropped (and tripped an assertion in debug builds). [#37025](https://github.com/oven-sh/bun/pull/37025)
- **`Bun.inspect()` and `Bun.deepEquals()`**: objects mutated by a custom inspect hook or getter during formatting or comparison are handled safely.
- GitHub Actions error annotations no longer drop non-ASCII bytes from the title and body, so a test throwing `"hello é world"` shows the full message instead of a truncated fragment. [#32736](https://github.com/oven-sh/bun/pull/32736)
- `expect.any(Object)` now matches `null` and rejects functions, matching Jest's `typeof === "object"` semantics. [#32922](https://github.com/oven-sh/bun/pull/32922)
- `expect().toContain()` now compares array and iterable elements with `===` instead of `Object.is`, matching Jest. `expect([-0]).toContain(0)` now passes and `expect([NaN]).toContain(NaN)` now fails. [#32950](https://github.com/oven-sh/bun/pull/32950)
- `jest.resetAllMocks()` and `vi.resetAllMocks()` now reset mock implementations and return values, not just call history. Previously both were bound to the same function as `clearAllMocks()`. [#33374](https://github.com/oven-sh/bun/pull/33374)
- Fixed the `oven/bun` Debian and Debian-slim Docker images failing `apt-get` over HTTPS with `certificate verify failed`; `ca-certificates` is now installed in the final stage. [#33136](https://github.com/oven-sh/bun/pull/33136)
