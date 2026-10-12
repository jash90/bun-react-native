---
source: https://bun.com/blog/bun-v1.4.3 (markdown: https://bun.com/blog/bun-v1.4.3.md)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504 (docs repo HEAD at fetch time; blog posts fetched from bun.com)
---

---
title: Bun v1.4.3
description: "Fixes 166 issues, addressing 122 👍. bun check, a TypeScript type checker built into Bun that is 3x to 6.4x faster than tsc 7, --check for bun run, bun build and bun test, 67–89% less idle CPU, Bun.FetchSession, experimental Bun.ModuleGraph, --disallow-code-generation-from-strings, up to 2.7x faster large node:http responses, a JavaScriptCore upgrade with faster JSON.parse, faster rejected-promise handling, CompressionStream compression levels, If-Range support in Bun.serve, bun install skips tarballs it won't install, lower bun build memory with many entry points, [hashN] output names, profile-guided bytecode layout and faster startup for --compile --bytecode, and many bugfixes and Node.js compatibility improvements."
date: "2026-10-10T03:18:05.517Z"
author: jarred
---

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

## `bun check`: a TypeScript type checker built into Bun

![bun check, a TypeScript type checker built into Bun, is 3x to 7x faster than tsc 7. Type checking VS Code, 10,947 files: bun check takes 1.75 s and 2.77 GiB, tsc 7 with --checkers 16 takes 5.88 s and 9.23 GiB, and tsc 7 (typescript-go) with default settings takes 12.58 s and 7.73 GiB. That is 2.8x to 3.3x less memory. Linux x64, 64 threads, mean of 20 runs. bun check passes 100% of TypeScript's conformance tests and is a port of typescript-go.](/images/bun-check-1.4.3.webp)

`bun check` is an incredibly fast TypeScript type checker that passes 100% of TypeScript 7.0.2's conformance test suite.

```sh
$ bun check
1 | import { greet } from "./user";
2 |
3 | const message = greet({ id: "1", name: "Ada" });
                            ^
error: TS2322: Type 'string' is not assignable to type 'number'.
    at src/index.ts:3:25

Found 1 error in 1 file, checked 2 files [14.00ms]
```

It's 3x to 6.4x faster than `tsc` 7.0.2, on a 16-core Apple silicon Mac:

| Project                 | Files | `bun check` | `tsc` 7.0.2 | Faster |
| ----------------------- | ----: | ----------: | ----------: | -----: |
| VS Code `src`           | 9,795 |      1.24 s |      5.98 s |   4.8x |
| mikro-orm               | 2,883 |      1.20 s |      5.97 s |   5.0x |
| Next.js `packages/next` | 2,881 |      0.28 s |      1.82 s |   6.4x |
| Next.js, root           | 3,547 |      0.42 s |      1.28 s |   3.1x |
| Storybook `scripts`     | 1,039 |      0.27 s |      0.96 s |   3.5x |
| Nuxt                    |   839 |      0.27 s |      0.80 s |   3.0x |
| Playwright              |   706 |      0.15 s |      0.64 s |   4.2x |
| lit `packages/react`    |     6 |      0.46 s |      2.12 s |   4.6x |

And it uses 2.2x to 4.9x less memory:

| Project                 | Files | `bun check` | `tsc` 7.0.2 | Less |
| ----------------------- | ----: | ----------: | ----------: | ---: |
| VS Code `src`           | 9,795 |     2.14 GB |     7.97 GB | 3.7x |
| mikro-orm               | 2,883 |     1.35 GB |     6.67 GB | 4.9x |
| Next.js `packages/next` | 2,881 |     0.71 GB |     1.81 GB | 2.5x |
| Next.js, root           | 3,547 |     0.55 GB |     1.33 GB | 2.4x |
| Storybook `scripts`     | 1,039 |     0.56 GB |     1.39 GB | 2.5x |
| Nuxt                    |   839 |     0.51 GB |     1.14 GB | 2.2x |
| Playwright              |   706 |     0.46 GB |     1.06 GB | 2.3x |
| lit `packages/react`    |     6 |     0.24 GB |     0.63 GB | 2.6x |

It's a port of [typescript-go](https://github.com/microsoft/typescript-go). It reads your `tsconfig.json`, reports the same errors as `tsc`, and uses every CPU core. You don't need the `typescript` package installed.

It only type checks. It doesn't emit JavaScript or `.d.ts` files, and there's no language server, so your editor keeps using TypeScript.

### `bun run --check`

Type check, then run. If there's a type error, your code doesn't run.

```sh
$ bun run --check src/index.ts
1 | import { greet } from "./user";
2 |
3 | console.log(greet({ id: "1", name: "Ada" }));
                        ^
error: TS2322: Type 'string' is not assignable to type 'number'.
    at src/index.ts:3:21

2 |   id: number;
      ^
note: The expected type comes from property 'id' which is declared here on type 'User'
   at src/user.ts:2:3

Found 1 error in 1 file, checked 2 files [24.00ms]
```

It also works with `package.json` scripts (`bun run --check dev`) and with `--watch`, which checks again before every restart.

### `bun test --check`

Type check the test files and everything they import, then run the tests. If there's a type error, no tests run.

```sh
$ bun test --check
bun test v1.4.3
4 | test("greet", () => {
5 |   expect(greet({ id: "1", name: "Ada" })).toBe("hello Ada");
                     ^
error: TS2322: Type 'string' is not assignable to type 'number'.
    at src/user.test.ts:5:18

2 |   id: number;
      ^
note: The expected type comes from property 'id' which is declared here on type 'User'
   at src/user.ts:2:3

Found 1 error in 1 file, checked 2 files [23.94ms]
```

### `bun build --check`

Type check, then bundle. A type error fails the build like any other build error, and nothing is written.

```sh
$ bun build --check ./src/index.ts --outdir out
3 | console.log(greet({ id: "1", name: "Ada" }));
                        ^
error: TS2322: Type 'string' is not assignable to type 'number'.
    at /app/src/index.ts:3:21

2 |   id: number;
      ^
note: TS6500: The expected type comes from property 'id' which is declared here on type 'User'
   at /app/src/user.ts:2:3
```

`Bun.build` takes `check: true`.

### Testing `bun check`

Every commit of Bun runs TypeScript 7.0.2's complete conformance test suite (and we will continue to keep it up-to-date as TypeScript itself updates).

| Baseline          | What it checks               |      Tests |    Passing |
| ----------------- | ---------------------------- | ---------: | ---------: |
| Errors            | Every error                  |     13,101 |     13,101 |
| Types             | The type of every expression |     12,463 |     12,463 |
| Symbols           | The symbol behind every name |     12,463 |     12,463 |
| Declarations      | Emitted `.d.ts` files        |     13,032 |     13,032 |
| Module resolution | How every import resolves    |        151 |        151 |
| **Total**         |                              | **51,210** | **51,210** |

#### 72 misconfigured open-source projects

For a project as complex as a TypeScript type checker, conformance tests aren't enough, so we deliberately misconfigured 72 popular open-source repositories and compared `bun check`'s output with `tsc`'s output.

Missing `node_modules`, mismatched TypeScript versions, no build step. Every error has to match: same file, line, column and error code.

| Project                                                                                       |   Configs | Identical |      Errors | Mismatches |
| --------------------------------------------------------------------------------------------- | --------: | --------: | ----------: | ---------: |
| [anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript) |        16 |        16 |         596 |          0 |
| [apollographql/apollo-client](https://github.com/apollographql/apollo-client)                 |         7 |         7 |         559 |          0 |
| [arktypeio/arktype](https://github.com/arktypeio/arktype)                                     |         5 |         5 |         389 |          0 |
| [axios/axios](https://github.com/axios/axios)                                                 |         1 |         1 |         105 |          0 |
| [colinhacks/zod](https://github.com/colinhacks/zod)                                           |        10 |        10 |         191 |          0 |
| [date-fns/date-fns](https://github.com/date-fns/date-fns)                                     |         3 |         3 |           1 |          0 |
| [discordjs/discord.js](https://github.com/discordjs/discord.js)                               |         2 |         2 |           3 |          0 |
| [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm)                       |         3 |         3 |      10,786 |          0 |
| [Effect-TS/effect](https://github.com/Effect-TS/effect)                                       |        10 |        10 |           2 |          0 |
| [elysiajs/elysia](https://github.com/elysiajs/elysia)                                         |         4 |         4 |          53 |          0 |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)                             |         7 |         7 |      11,048 |          0 |
| [fabian-hiller/valibot](https://github.com/fabian-hiller/valibot)                             |         2 |         2 |           1 |          0 |
| [fastify/fastify](https://github.com/fastify/fastify)                                         |         1 |         1 |           0 |          0 |
| [gcanti/fp-ts](https://github.com/gcanti/fp-ts)                                               |         2 |         2 |           3 |          0 |
| [gcanti/io-ts](https://github.com/gcanti/io-ts)                                               |         2 |         2 |           3 |          0 |
| [graphql/graphql-js](https://github.com/graphql/graphql-js)                                   |         3 |         3 |          24 |          0 |
| [gvergnaud/ts-pattern](https://github.com/gvergnaud/ts-pattern)                               |         2 |         2 |           2 |          0 |
| [honojs/hono](https://github.com/honojs/hono)                                                 |         6 |         6 |      14,239 |          0 |
| [immerjs/immer](https://github.com/immerjs/immer)                                             |         1 |         1 |           5 |          0 |
| [jquense/yup](https://github.com/jquense/yup)                                                 |         1 |         1 |           1 |          0 |
| [kysely-org/kysely](https://github.com/kysely-org/kysely)                                     |         6 |         6 |       1,185 |          0 |
| [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs)                       |        41 |        41 |       5,273 |          0 |
| [lit/lit](https://github.com/lit/lit)                                                         |        34 |        34 |       2,588 |          0 |
| [microsoft/playwright](https://github.com/microsoft/playwright)                               |         4 |         4 |          22 |          0 |
| [microsoft/TypeScript](https://github.com/microsoft/TypeScript)                               |         4 |         4 |         613 |          0 |
| [microsoft/vscode](https://github.com/microsoft/vscode), its own build                        |         1 |         1 |           0 |          0 |
| microsoft/vscode, extensions and tests                                                        |       105 |       105 |       5,685 |          0 |
| [mikro-orm/mikro-orm](https://github.com/mikro-orm/mikro-orm)                                 |        17 |        17 |      87,981 |          0 |
| [millsp/ts-toolbelt](https://github.com/millsp/ts-toolbelt)                                   |         1 |         1 |           3 |          0 |
| [mobxjs/mobx](https://github.com/mobxjs/mobx)                                                 |         3 |         3 |         186 |          0 |
| [mswjs/msw](https://github.com/mswjs/msw)                                                     |        10 |        10 |       5,878 |          0 |
| [nestjs/nest](https://github.com/nestjs/nest)                                                 |        30 |        30 |      27,345 |          0 |
| [nuxt/nuxt](https://github.com/nuxt/nuxt)                                                     |         3 |         3 |          11 |          0 |
| [openai/openai-node](https://github.com/openai/openai-node)                                   |         4 |         4 |           6 |          0 |
| [pmndrs/jotai](https://github.com/pmndrs/jotai)                                               |         2 |         2 |           7 |          0 |
| [pmndrs/valtio](https://github.com/pmndrs/valtio)                                             |         1 |         1 |           0 |          0 |
| [pmndrs/zustand](https://github.com/pmndrs/zustand)                                           |         1 |         1 |           0 |          0 |
| [preactjs/preact](https://github.com/preactjs/preact)                                         |         1 |         1 |           1 |          0 |
| [prisma/prisma](https://github.com/prisma/prisma)                                             |        44 |        44 |      24,201 |          0 |
| [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer)                                 |        10 |        10 |       2,701 |          0 |
| [react-hook-form/react-hook-form](https://github.com/react-hook-form/react-hook-form)         |         2 |         2 |           3 |          0 |
| [ReactiveX/rxjs](https://github.com/ReactiveX/rxjs)                                           |        10 |        10 |      22,271 |          0 |
| [reduxjs/redux](https://github.com/reduxjs/redux)                                             |         1 |         1 |           0 |          0 |
| [reduxjs/redux-toolkit](https://github.com/reduxjs/redux-toolkit)                             |         8 |         8 |         142 |          0 |
| [remeda/remeda](https://github.com/remeda/remeda)                                             |         7 |         7 |          13 |          0 |
| [remix-run/react-router](https://github.com/remix-run/react-router)                           |        14 |        14 |       6,735 |          0 |
| [rollup/rollup](https://github.com/rollup/rollup)                                             |         9 |         9 |         107 |          0 |
| [sequelize/sequelize](https://github.com/sequelize/sequelize)                                 |        16 |        16 |       6,768 |          0 |
| [sindresorhus/got](https://github.com/sindresorhus/got)                                       |         1 |         1 |           2 |          0 |
| [sindresorhus/ky](https://github.com/sindresorhus/ky)                                         |         2 |         2 |          52 |          0 |
| [sindresorhus/type-fest](https://github.com/sindresorhus/type-fest)                           |         2 |         2 |           0 |          0 |
| [solidjs/solid](https://github.com/solidjs/solid)                                             |         7 |         7 |         740 |          0 |
| [statelyai/xstate](https://github.com/statelyai/xstate)                                       |         8 |         8 |         545 |          0 |
| [storybookjs/storybook](https://github.com/storybookjs/storybook)                             |        19 |        19 |       1,401 |          0 |
| [stripe/stripe-node](https://github.com/stripe/stripe-node)                                   |         4 |         4 |          42 |          0 |
| [sveltejs/svelte](https://github.com/sveltejs/svelte)                                         |         5 |         5 |         186 |          0 |
| [TanStack/form](https://github.com/TanStack/form)                                             |        13 |        13 |         124 |          0 |
| [TanStack/query](https://github.com/TanStack/query)                                           |        15 |        15 |         686 |          0 |
| [TanStack/router](https://github.com/TanStack/router)                                         |        29 |        29 |       4,853 |          0 |
| [TanStack/table](https://github.com/TanStack/table)                                           |        20 |        20 |         574 |          0 |
| [tldraw/tldraw](https://github.com/tldraw/tldraw)                                             |         4 |         4 |           0 |          0 |
| [total-typescript/ts-reset](https://github.com/total-typescript/ts-reset)                     |         2 |         2 |           4 |          0 |
| [typeorm/typeorm](https://github.com/typeorm/typeorm)                                         |         4 |         4 |         959 |          0 |
| [typescript-eslint/typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) |        35 |        35 |      18,392 |          0 |
| [unjs/h3](https://github.com/unjs/h3)                                                         |         1 |         1 |           0 |          0 |
| [unjs/nitro](https://github.com/unjs/nitro)                                                   |         5 |         5 |         742 |          0 |
| [urql-graphql/urql](https://github.com/urql-graphql/urql)                                     |         2 |         2 |          17 |          0 |
| [vercel/ai](https://github.com/vercel/ai)                                                     |        52 |        52 |       9,742 |          0 |
| [vercel/next.js](https://github.com/vercel/next.js)                                           |       356 |       356 |       3,690 |          0 |
| [vercel/swr](https://github.com/vercel/swr)                                                   |         4 |         4 |         314 |          0 |
| [vitest-dev/vitest](https://github.com/vitest-dev/vitest)                                     |        18 |        18 |       2,111 |          0 |
| [vuejs/core](https://github.com/vuejs/core)                                                   |         6 |         5 |       1,359 |          1 |
| [withastro/astro](https://github.com/withastro/astro)                                         |        12 |        12 |       1,996 |          0 |
| **All 72**                                                                                    | **1,103** | **1,102** | **286,267** |      **1** |

The one mismatch is in vuejs/core. `tsc` only reports that error when `global.ts` comes before `model.ts` in `files`.

We ran 69 of them again under 11 other sets of compiler options:

| Compiler options                           | Projects | Identical |      Errors | Mismatches |
| ------------------------------------------ | -------: | --------: | ----------: | ---------: |
| Every strictness flag on                   |       69 |        69 |     100,756 |          0 |
| `strict` off                               |       69 |        68 |      76,960 |         12 |
| `skipLibCheck` off                         |       69 |        69 |      90,609 |          0 |
| `checkJs`                                  |       69 |        69 |      84,122 |          0 |
| `declaration`                              |       69 |        69 |      80,495 |          0 |
| `isolatedModules` + `verbatimModuleSyntax` |       69 |        69 |      80,622 |          0 |
| `isolatedDeclarations`                     |       62 |        62 |      34,982 |          0 |
| `erasableSyntaxOnly` + legacy decorators   |       69 |        69 |      71,577 |          0 |
| `nodenext`                                 |       69 |        69 |      85,238 |          0 |
| `"types": []`                              |       69 |        69 |     105,818 |          0 |
| `"lib": ["es5"]`                           |       69 |        69 |      83,872 |          0 |
| **All 11**                                 |  **752** |   **751** | **895,051** |     **12** |

#### Fuzzing & mutation testing

Each fuzzer generates every combination of a set of language features, runs `tsc` and `bun check` on the result, and diffs the output.

| Fuzzer                                             |   Functions | Mismatches |
| -------------------------------------------------- | ----------: | ---------: |
| Control flow narrowing                             |      46,080 |          0 |
| Variables with no type annotation                  |      29,484 |          0 |
| Variables reassigned inside 12 kinds of loop       |      20,304 |          0 |
| Callbacks and contextual typing                    |       9,984 |          0 |
| Circular references                                |       9,196 |          0 |
| Interfaces that extend a mapped type of themselves |       8,424 |          0 |
| Index signatures                                   |       5,770 |          0 |
| Circular references next to overloaded calls       |       3,888 |          0 |
| Boolean assignability                              |       1,664 |          0 |
| 8 smaller fuzzers                                  |       1,441 |          0 |
| **Total**                                          | **136,235** |      **0** |

Those run on every commit. These are larger runs we did offline:

| Fuzzer                                              |      Programs | Mismatches |
| --------------------------------------------------- | ------------: | ---------: |
| Overloads, inference and variance                   |     1,300,000 |          0 |
| Where long types get cut off in error messages      |     1,060,000 |          0 |
| Classes: access, overrides, initialization, `super` |       290,000 |          0 |
| Duplicate declarations of a variable or property    |       123,891 |          0 |
| JSDoc in type-checked JavaScript                    |        68,334 |          0 |
| JSX: tags, attributes and children                  |        63,770 |          0 |
| Annotations that refer to what's being declared     |        50,688 |         95 |
| Class expressions that refer to what holds them     |        40,128 |         21 |
| Immediately invoked functions                       |        19,200 |         21 |
| Symbols that `tsc` creates lazily                   |        15,444 |         25 |
| Infinitely recursive type aliases                   |           517 |         28 |
| Module augmentation through re-exports              |           210 |          1 |
| **Total**                                           | **3,032,182** |    **191** |

162 of the 191 mismatches are in code that refers to itself while it's being declared, like `class A { x = { a: null! as { p: A["x"] } } }`.

For mutation testing, we broke [Effect](https://github.com/Effect-TS/effect)'s source 913 times (swapped arguments, dropped type arguments, deleted overloads) and compared every error.

| Mutations | Errors in `tsc` | Missing in `bun check` | Only in `bun check` |
| --------: | --------------: | ---------------------: | ------------------: |
|       913 |           2,925 |                      0 |                   0 |

| Also on every commit                                                             |   Count |
| -------------------------------------------------------------------------------- | ------: |
| Fuzzer-generated functions, diffed against `tsc`                                 | 136,235 |
| Edge cases found by reading typescript-go next to the port, diffed against `tsc` |   2,362 |
| Corrupted source files that still have to report an error                        |   1,893 |
| Generated projects: file name casing, malformed `tsconfig.json`, `references`    |     656 |
| Regression tests                                                                 |     576 |

#### Try it on your project

```sh
bunx -p typescript@7.0.2 tsc --noEmit --pretty false > tsc.txt
bun check --no-pretty > bun.txt
diff tsc.txt bun.txt
```

If there's a difference, that's a bug in Bun. Please [open an issue](https://github.com/oven-sh/bun/issues).

[Read the `bun check` docs](/docs/runtime/check).

<!-- https://github.com/oven-sh/bun/commit/bbdc5a519e0a06d1b3133b564f91096b9ba10a31 -->

## New in the runtime

### 67–89% less CPU while your server sleeps

![Bun v1.4.3 uses 67–89% less CPU than v1.4.2 while your server sleeps. In one idle minute, v1.4.2 woke up every second, because any occasional request kept the 1-second GC timer running. v1.4.3 wakes only for the health check, every 10 seconds. CPU ms in 2 idle minutes on v1.3.14, v1.4.0, v1.4.2 and v1.4.3: Express 430, 308, 282, 57. Fastify 450, 284, 267, 57. Elysia 473, 280, 197, 21. Hono 417, 263, 195, 21. Next.js SSR 7,029, 628, 815, 268. 6–11% less idle memory than v1.4.2. Measured after a 30 s load test with one health check every 10 s, on Linux x64.](/images/idle-cpu-1.4.3.webp)

<!-- https://github.com/oven-sh/bun/commit/31f10701e3342e347586e83861ecdcabdd2ce280 -->

### `Bun.FetchSession`

`Bun.FetchSession` gives a group of requests their own TLS, proxy, and keep-alive settings and their own connection pool. Sessions never share connections with each other or with plain `fetch()`.

```ts
const session = new Bun.FetchSession({
  tls: { ca: await Bun.file("corp-ca.pem").text() },
  proxy: { url: "http://proxy.internal:8080" },
  keepAlive: { idleTimeout: 30, maxIdleSockets: 8 },
});

const client = new SomeClient({ fetch: session.fetch });
await fetch("https://example.com", { session }); // same thing
```

- `session.fetch` is bound, so any client that accepts a `fetch` function can use it.
- Options on the request override the session's.
- `session.close()` (or `using`) closes idle connections.
- A session's `tls.checkServerIdentity` runs once per connection. Requests that reuse the connection skip it.

### Better proxy environment support in `fetch()`

`NO_PROXY` accepts wildcards, CIDR blocks, bare IPv6 addresses, and `host:port`.

```sh
NO_PROXY="*.internal.example.com, 10.0.0.0/8, fd00::/8, localhost:3000"
```

`ALL_PROXY` is used when `HTTP_PROXY` / `HTTPS_PROXY` is unset. `proxy: false` ignores the proxy environment for one request.

```ts
await fetch("https://example.com", { proxy: false });
```

When a proxy refuses `CONNECT` with a non-2xx status, `fetch()` rejects with `ERR_PROXY_TUNNEL`. The error carries the proxy's `status` and `headers`. Before, `fetch()` resolved with the proxy's reply as if it came from the origin.

<!-- https://github.com/oven-sh/bun/commit/63a495cb4678a5ca0c0fa93fd6a62ddc1bc06b70 -->

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

### Up to 2.7x faster large responses in `node:http`

A response over 16 KB now goes out in one write per tick instead of up to 16. It applies to `node:http` and `Bun.serve`, over HTTP and HTTPS.

Requests per second from a `node:http` server:

| Response                      |  After | Before | Node.js 26.3 |
| ----------------------------- | -----: | -----: | -----------: |
| 4 × `res.write(16 KB)`        | 19,160 |  6,983 |       17,735 |
| 4 × `res.write(16 KB)`, HTTPS | 15,510 |  6,110 |       11,720 |
| 40 × `res.write(2 KB)`        | 14,980 |  6,140 |        9,879 |
| `res.end(64 KB)`              | 19,889 | 16,528 |       18,535 |

`node:http` was slower than Node in six of eight large-response benchmarks. Now it's faster in all eight. A `Bun.serve` direct stream writing 4 × 16 KB is 83% faster. Small responses are unchanged.

<!-- https://github.com/oven-sh/bun/commit/5d5f03ff4889882ec458e9b29155f4d2e1f31812 -->

### JavaScriptCore upgrade

Bun's JavaScriptCore engine picks up upstream WebKit performance work and spec fixes.

| Operation                                              | Change                       |
| ------------------------------------------------------ | ---------------------------- |
| `JSON.parse()` on npm registry manifests               | 1.2x–1.5x faster             |
| `JSON.parse()` on 1,000 objects with the same keys     | 1.5x faster                  |
| `/^\/users\/(\d+)$/.test(path)` in a router benchmark  | ~5x faster                   |
| `Object.values(obj)` with 9+ properties                | 2.3x–3.2x faster             |
| `arr.copyWithin(0, 1)`                                 | ~2x faster, ~45x with holes  |
| `arr.includes(x)` on long number arrays                | 2.4x–3.3x faster             |
| `arr.splice(2, 1, x)`                                  | new fast path                |
| `for (const x of arr)`, and the same for strings       | no iterator object allocated |
| `const [a, b] = arr`                                   | no iterator object allocated |

The `JSON.parse` numbers are against Bun v1.4.2 on an Apple silicon Mac, with manifests from 331 KB to 8 MB. The `for...of` and destructuring change helps code that hasn't reached the top JIT tier yet.

- WebAssembly wide arithmetic (`i64.add128`, `i64.mul_wide_u` and friends) is on by default.
- `RegExp.escape()` no longer escapes supplementary code points like U+2002A.
- `Atomics.isLockFree(4294967297)` returns `false` instead of wrapping to `1`.
- A strict-mode async generator that does `return someCall()` awaits the returned promise.
- `++arr.length` in a loop no longer slows down quadratically past 100,000 elements.
- `BigInt("-")`, `BigInt("+")` and `BigInt("0x")` throw `SyntaxError` instead of returning `0n`.
- `(a?.b)(x)` throws a `TypeError` when `a` is `null` or `undefined`. Before, it returned `undefined`, as if the parentheses weren't there.
- `` super.tag`x` `` calls `tag` with the current `this`.
- `Error.stackTraceLimit` is read from the `Error` constructor when a stack is captured, like V8. `node:vm` contexts start at 10, matching Node.
- JIT-optimized code with many live floating-point values no longer turns one into `NaN` after reading `arr[i]`. This could happen if `arr` was sometimes a `Float32Array` or `Float64Array` and sometimes another kind of object.
- `Intl.DurationFormat` keeps the minus sign of a duration between -1 and 0. With `seconds: "numeric"`, `{ milliseconds: -500 }` formats as `-0.5` instead of `0.5`.
- `Intl.Segmenter`'s `containing(index)` returns the right segment when `index` is the first half of a surrogate pair, like the start of an emoji.
- On Windows, WebAssembly fast memory is enabled again. Growing a WebAssembly memory or a resizable `ArrayBuffer` at the system commit limit throws instead of crashing.
- `--bytecode` output is 3–6% smaller.

<!-- https://github.com/oven-sh/bun/commit/6a92015fc89e1da27e3c781a3a3d6540c104dd13 -->

### Faster handling of many rejected promises

`Promise.allSettled` over thousands of throwing async calls no longer stalls. Attaching handlers to many promises that reject in the same turn took quadratic time. It is linear now.

```ts
await Promise.allSettled(
  Array.from({ length: 100_000 }, async () => {
    throw new Error("nope");
  }),
);
```

|         |   Time |
| ------- | -----: |
| After   | 148 ms |
| Before  |   24 s |
| Node.js | 475 ms |

Attaching `.catch()` to 160,000 already-rejected promises went from 83 s to 24 ms.

<!-- https://github.com/oven-sh/bun/commit/8c722e267c9b0df1826b4691eadb5ec10f8d54bb -->

### `CompressionStream` accepts a compression level

Pass a `level` option to `CompressionStream` to trade ratio for speed. Brotli previously always ran at quality 11, which is very slow for large, dynamic responses.

```ts
const stream = new CompressionStream("brotli", { level: 4 });
```

- `gzip`, `deflate`, `deflate-raw`: 0-9
- `brotli`: 0-11
- `zstd`: 1-22

Out-of-range values throw a `RangeError`. Omitting `level` keeps each format's current default.

<!-- https://github.com/oven-sh/bun/commit/c00dd111279efdab7aa1ce93697514066ba04046 -->

### `Bun.serve` supports `If-Range`

Clients can safely resume a download from `Bun.serve`. A `Range` request with `If-Range` gets the range only if the file hasn't changed. Otherwise it gets the full body.

```ts
await fetch("http://localhost:3000/big.bin", {
  headers: {
    Range: "bytes=1000-",
    "If-Range": lastModified, // from the first response
  },
});
// 206 if the file is unchanged, 200 with the full body if it changed
```

It works for `Bun.file` responses and `{ dir }` routes.

<!-- https://github.com/oven-sh/bun/commit/d115f548e9b85aa8efb412e539c4025f31640d3a -->

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

### Lower memory usage in `bun build` with many entry points

Builds with many entry points or chunks use much less memory.

| Peak RSS, 800 entry points                                             |  After |   Before |
| ---------------------------------------------------------------------- | -----: | -------: |
| Each imports one export from a file with 200,000 exports, `--splitting` | 276 MB | 2,121 MB |
| 13 modules each, with or without `--splitting`                          | 200 MB |   405 MB |

This fixes a regression from Bun v1.4.1 where `bun build --splitting` with ~800 chunks peaked at 7.7 GB instead of 6.2 GB. On Windows, it could abort with `memory allocation of N bytes failed`.

<!-- https://github.com/oven-sh/bun/commit/0b7b77e66e72d6bde1a0fc202551f2be9747f23b -->

### `Bun.build` supports `[hashN]` in output names

Large `--splitting` builds no longer fail with "Multiple files share the same output path". Before, two chunks with different contents could get the same 8-character `[hash]` name. Now both names get extra hash characters until they differ.

Use `[hash9]` through `[hash13]` to set a wider minimum hash. `[hash13]` is the full 64-bit hash.

```ts
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  splitting: true,
  naming: { chunk: "chunk-[hash13].[ext]" },
});
```

<!-- https://github.com/oven-sh/bun/commit/c01965ff724cabd72936c3b517d85902712731e0 -->

### Metafile names the input file behind a split `import()`

With `--splitting`, each dynamic `import()` in `metafile.inputs` has an `entryPoint` field naming the input file it loads, so tools that build a module graph no longer have to join through `outputs`. Metafile byte counts and `--metafile-md` output are now accurate too.

```json#meta.json
{
  "path": "./chunk-abc123.js",
  "kind": "dynamic-import",
  "original": "./lazy.js",
  "entryPoint": "lazy.js",
  "external": true
}
```

- `entryPoint` is a key of `inputs`. A `require()` of an ES module with `--target=bun` gets one too. True externals like `import("node:fs")` don't.

<!-- https://github.com/oven-sh/bun/commit/290c2163e277f4519f4f589287b37e55a18baa31 -->

## New in `bun build --compile`

### `bun build --compile` supports profile-guided bytecode layout

`--bytecode-order` lays out a `--compile --bytecode` executable from a profile of a real run. The bytecode that run used goes together at the front of the file.

In one large CLI app, cold start went from 1.01s to 0.53s. Resident bytecode memory at its prompt went from 59.5 MB to 20.5 MB.

```sh
bun build --compile --bytecode ./cli.ts --outfile myapp

# Run it the way your users do. The profile is written on exit.
BUN_BYTECODE_ORDER_OUT=myapp.order ./myapp --help

bun build --compile --bytecode --bytecode-order=myapp.order ./cli.ts --outfile myapp
```

- Functions are matched by a hash of their syntax, so a profile from an older build still applies.
- `--bytecode-order=a.order,b.order` takes several profiles, most common first.
- `Bun.build` uses `compile: { bytecodeOrder: "./myapp.order" }`.
- `bytecodeOrderStats()` from `bun:jsc` reports how many loaded functions the profile covered.

<!-- https://github.com/oven-sh/bun/commit/4227e466c4893034efcbf3a69402fa8fd865463f -->

### Faster startup for `--compile --bytecode` executables

Executables built with `bun build --compile --bytecode` start faster. ESM executables embed a pre-resolved module graph and optimized bytecode and load every bundled module in one pass, and JavaScriptCore does less work to decode embedded bytecode and link compiled functions.

On a ~2,300-module CLI app, time to the first interactive prompt went from 698 ms to 579 ms (−17%). On a ~2,000-module CLI, the bytecode decode changes alone cut 6.3% of instructions to its first prompt.

```sh
$ bun build ./app.ts --compile --bytecode --format=esm --outfile myapp
```

The new `--compile-jit-policy <n>` flag (`compile: { jitPolicy: n }` in `Bun.build`) scales JIT tier-up thresholds. Run-once startup code stays in the interpreter longer. Call `Bun.unsafe.setJITPolicy(1)` once your app is interactive:

```ts
await renderFirstScreen();
Bun.unsafe.setJITPolicy(1); // back to the normal JIT policy
```

- `--no-optimize-bytecode` / `optimize: { bytecode: false }` skips the build-time bytecode optimizer.

<!-- https://github.com/oven-sh/bun/commit/5f554969bc8ab2159583cdf5ff26f5277ca35e91 -->

## Other improvements

- Fixed: `crypto.randomInt()` was about 20x slower per call since Bun 1.4.0. It takes 34 ns instead of 760 ns, on par with Node.js.

<!-- https://github.com/oven-sh/bun/commit/aafd78b6d5d53fdf53fc256d908390db9162d9f8 -->

- Fixed: small zstd calls were up to 3.7x slower in x64 virtual machines since Bun v1.4.0. `Bun.zstdDecompressSync` on a 1 KB input takes 1.38 µs instead of 5.11 µs.

<!-- https://github.com/oven-sh/bun/commit/8987cd77266e77d7f09ec3f43a48c96fd45d3c14 -->

- Fixed: `node:zlib` calls on small inputs were slower since Bun v1.4.0. `gunzipSync` with a 1 KB result takes 2.97 µs instead of 4.99 µs, and 64 MB through gzip streams takes 131 ms instead of 166 ms.

<!-- https://github.com/oven-sh/bun/commit/baa67e3f4e6924151432cb7a77e61578ce3e9a1c -->

- Fixed: `Bun.color()` got slower in Bun v1.4.0, and this recovers most of that. A call takes 208 ns instead of 692 ns, and 432 ns instead of 17,793 ns when 8 Workers call it at once.
- Improved: a short `transpiler.transformSync()` call takes 550 ns instead of 1,236 ns, and 2,290 ns instead of 15,246 ns when 8 Workers call it at once.

<!-- https://github.com/oven-sh/bun/commit/b73ae471a057b796b333a561ebc90e2e42050707 -->

- Improved: `vm.runInContext()` and `vm.runInNewContext()` are about 30% faster per call (2.5 µs to 1.7 µs). `new vm.Script(src, {})` is about 2x faster. This recovers most of a 1.4.0 regression.

<!-- https://github.com/oven-sh/bun/commit/c8e1f6fa5b99ecddb0c39a1987e3d6b6bda6eb6f -->

- Improved: `Bun.serve` answers pipelined HTTP/1.1 requests with one `send()` for the whole batch instead of about 14 syscalls per response. This fixes a regression from Bun v1.2.6.

<!-- https://github.com/oven-sh/bun/commit/86e3c7584f37f17d4050f1c95fbbec212a24f274 -->

- Improved: `Object.keys(require.cache)` and `key in require.cache` no longer leak a namespace object per loaded ES module. Listing 2,000 modules dropped from 38 ms to 2.6 ms.

<!-- https://github.com/oven-sh/bun/commit/62ceb03d16376e525912fd4906cba92118ee3899 -->

- Improved: `Bun.markdown.render()` no longer takes quadratic time on deeply nested lists or emphasis when no callback is registered for the nested element. In Bun v1.4.2, 300 KB of nested lists took 99.5 s.

<!-- https://github.com/oven-sh/bun/commit/7000dc1b6b2a0f85e43cccbbcbd4031db8a4ef0e -->

- Improved: `Bun.gc(true)` and `gc()` return freed memory to the OS before returning, so RSS drops right away instead of after a delay. This holds even when a background purge is in progress, and memory freed during a purge no longer stays resident until the event loop goes idle.

<!-- https://github.com/oven-sh/bun/commit/24271499a0fc715520050d5131b29ea374636377 -->

- Improved: Bun's mimalloc fork is now slightly smarter about when to give freed memory back to the operating system. Echoing a 512 KiB JSON body, Elysia takes 388 page faults per request instead of 574, and Express 523 instead of 762.

<!-- https://github.com/oven-sh/bun/commit/c8b9b58531ba4d45271d66116229aea08198027d -->

- Improved: threads that are idle after `WebAssembly.compile()`, or blocked in `Atomics.wait()` or `Bun.sleepSync()`, give freed memory back to the OS after about 100 ms. A thread blocked for one second after freeing most of its heap held 115 MB instead of 424 MB.

<!-- https://github.com/oven-sh/bun/commit/1878660bb47a6a87ebe518cea0581ef4bf9b71f8 -->

- Improved: on macOS, `process.memoryUsage().rss` now reports the physical memory footprint that Activity Monitor shows, and `process.resourceUsage().maxRSS` reports its peak.

<!-- https://github.com/oven-sh/bun/commit/b99371011f0cf8664c31d4290b3bdb2d0b2e31e8 -->

- Improved: long-running `bun build --compile` apps on Linux keep less of Bun's own code resident in memory. Bun's linker order file now also traces app-shaped workloads.

<!-- https://github.com/oven-sh/bun/commit/46e03a5e3191823bcf2a5bbf40c863a927009ad6 -->

- Improved: on Windows, `Bun.secrets.set()` takes `persist: "local"` to keep a credential on the current computer. By default (`"enterprise"`) it roams with the user's account.

<!-- https://github.com/oven-sh/bun/commit/1016a7afb04a24098e9530d9a95b91d482d17f20 -->

- Improved: updated SQLite to 3.53.4, libarchive to 3.8.9, brotli to 1.2.0, lsquic to 4.9.4 and libjpeg-turbo to 3.2.0. Chunked HTTP bodies with bare-LF chunk line endings are now rejected, as in llhttp.

<!-- https://github.com/oven-sh/bun/commit/92fc9f295b76fcea2a7e043520742b015f666a05 -->

- Improved: updated the bundled root certificates to NSS 3.128 (Firefox 156). This adds SECOM and Telia TLS roots and removes Entrust Root Certification Authority, ePKI, Atos TrustedRoot 2011, and SecureSign Root CA12.

<!-- https://github.com/oven-sh/bun/commit/f5649a7edb4bf1e7cebf2da13a93f484df41ea6d -->

- Improved: the `oven/bun:alpine` Docker image is now based on Alpine 3.24, matching the libstdc++ the musl build links against.

<!-- https://github.com/oven-sh/bun/commit/c30126e0eb952e7155f0375a3eddcf75dedde4dc -->

- Improved: `bun test --coverage-reporter=lcov` now implies `--coverage`. Before, it ran the tests and wrote no report.

<!-- https://github.com/oven-sh/bun/commit/83b2d4fd526b5069f42368aca0647f3a34d0b4cc -->

## Bugfixes

### Security

- Hardened: `fetch`, `WebSocket`, `Bun.connect`, `Bun.RedisClient` and `Bun.SQL` verify the server during the TLS handshake instead of after it, like curl and Go. Error codes are unchanged.

- Hardened: TLS certificate name matching in `tls.connect`, `tls.checkServerIdentity`, `https`, `fetch` and `Bun.connect` only accepts valid host names and canonical IP addresses (CVE-2026-48618).

- Hardened: certificate verification in `node:tls` and `Bun.listen` when a connection closes during the TLS handshake.

- Hardened: certificate checks in `node:tls`, `https.Agent` and `fetch()` when a TLS session or pooled connection is reused. `fetch()` rejects a `tls.checkServerIdentity` that isn't a function or that returns a truthy value, as in Node.

- Hardened: `Bun.SQL` treats `tls: Bun.file("ca.pem")` (or `ssl:`) like `tls: { ca: Bun.file("ca.pem") }` and uses `verify-full`.

- Hardened: `node:http2` servers rate-limit stream resets (CVE-2023-44487, CVE-2025-8671). `streamResetBurst` and `streamResetRate` take effect, matching Node.

- Hardened: `Bun.serve` follows RFC 9112 more strictly after `Connection: close`.

- Hardened: rare scenario when precise conditions are met that can cause `req.url` and `req.headers` to return incorrect values on aborted requests in `Bun.serve()`.

- Hardened: TLS `Bun.serve()` servers apply the idle timeout to connections that never finish the handshake.

- Hardened: `fetch()` validates chunked transfer encoding in responses more strictly, like Node.
- Hardened: `fetch("file://host/path")` rejects with `ERR_INVALID_FILE_URL_HOST` unless the host is empty or `localhost`.

- Hardened: `fetch()` rejects when your code passes a `Content-Length` header that doesn't match the `ReadableStream` body it sends.

- Hardened: `fetch()` and `node:http` agents terminate an idle keep-alive connection that received unexpected data, matching Node.js.

- Hardened: `fetch()` against servers that close or reset a TLS connection at unexpected times. This fixes three rare crashes.

- Hardened: `bun install` parses registry and tarball URLs more strictly before attaching credentials.

- Hardened: `bun install` against malformed `bin` fields in a `package.json` or registry manifest.

- Hardened: `Bun.Archive#extract()`, `bun create` and `bun install` of `github:` dependencies against malformed tar archives.

- Hardened: `v8.deserialize()` and IPC with `serialization: "advanced"` against crafted records.

- Hardened: UDP socket `addMembership()`, `dropMembership()` and their source-specific variants against arguments with side effects.

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

### Bun APIs

- Fixed: `Bun.serve` dropped WebSocket frames that a client sent without waiting for the `101` response, when they arrived in the same TCP read as the upgrade request. Browsers wait for the `101`, so they were not affected.

<!-- https://github.com/oven-sh/bun/commit/663508d6d67b43a827e07e4c42812418f01cd8c4 -->

- Fixed: on Linux, a `Bun.serve` response serving a file of 1 MB or more could send file bytes before the end of its headers. This needed response headers too large for the kernel's send buffer (the repro used a 16 MB header).

<!-- https://github.com/oven-sh/bun/commit/8541df9fdaf31c588736614ff54bdb75f13e1ffd -->

- Fixed: in a `Bun.serve` server with `http2: true` or `http3: true`, some requests with a streamed response body were never released, so `pendingRequests` stayed above zero and a graceful `server.stop()` never resolved. Both options are off by default.
- Fixed: in `Bun.serve` with `http3: true`, calling `server.stop()` from inside a request handler spun at 100% CPU if that connection had already served a request. Calling `stop(true)` from a handler left clients waiting 10 to 30 seconds for their idle timeout.
- Fixed: in `Bun.serve` with `http2: true`, the tail of a streamed body under 256 bytes was sent twice when the client's flow-control window cut it off more than once, causing `PROTOCOL_ERROR`.

<!-- https://github.com/oven-sh/bun/commit/cf167237bf9a910d66aa87e13d6aad45302fb400 -->

- Fixed: in `Bun.serve({ http3: true })`, a request header value that a client sent with leading or trailing whitespace reached the handler untrimmed. `req.headers.get()` returned `" v\t"` where HTTP/1.1 gave `"v"`.

<!-- https://github.com/oven-sh/bun/commit/fd8422ce47d7083cf352769f0680d67137263032 -->

- Fixed: with `Bun.serve({ tls })`, `ws.terminate()` waited for the peer's TLS shutdown reply instead of closing at once. If the peer had stopped reading, the `close` handler did not run until the idle timeout, and `message()` could still fire.

<!-- https://github.com/oven-sh/bun/commit/f6aa93094ae12208afa9518f2f43d04585695320 -->

- Fixed: `Bun.serve` crashed with a stack overflow when a handler called `response.text()` on a `fetch()` Response without awaiting it, then returned that Response before its body arrived. It now responds with a 500 via `error()`.

<!-- https://github.com/oven-sh/bun/commit/ecf34905bab776c6e0e4d8b520e088c755a726f3 -->

- Fixed: `Bun.serve()` responded `200` with an empty body when a second `Response` reused a `ReadableStream` an earlier response already sent. It now errors.

<!-- https://github.com/oven-sh/bun/commit/504171566fb45b9a5796c7a139033ac2c37dfb4c -->

- Fixed: `Response.clone()` on a body from an unread `Bun.file().stream()` dropped the MIME type, so `Bun.serve` sent no `Content-Type` for the clone.

<!-- https://github.com/oven-sh/bun/commit/b5ba14b61204e22d6fbc56f20e13ef3f0c332bf1 -->

- Fixed: a `Bun.serve` handler that called `req.clone()` on a request with a body and then read neither copy leaked about 7 KB of memory per request.

<!-- https://github.com/oven-sh/bun/commit/8afe3cb89bad2142a8ef540239ff74797fa56d03 -->

- Fixed: a `Bun.serve` response with a `type: "direct"` stream sent an empty body when `pull()` wrote and then called `controller.close()` in the same tick. `cancel()` also ran after every completed response.
- Fixed: in a `Bun.serve` direct stream, a synchronous `pull()` that ended a chunked response (for example `flush()` then `end()`) and then threw in the same call wrote the last chunk twice. Strict clients then failed to parse the next keep-alive response.
- Fixed: in a `Bun.serve` direct stream, an async `pull()` that called `end()` after an `await` and then never returned kept its request pending, so a graceful `server.stop()` never resolved.
- Fixed: in a `Bun.serve` direct stream, a `flush(true)` promise never settled (and leaked) if `end()` was called while the socket was still backpressured.

<!-- https://github.com/oven-sh/bun/commit/8f33aaa9d3bbd27404f8608312bb40546f2bcb93 -->

- Fixed: calling `server.ref()` after `await server.stop()` completed kept the process alive forever.

<!-- https://github.com/oven-sh/bun/commit/cf2751ee655692c1dca7a9902dea7f9f0d70a8a1 -->

- Fixed: `Bun.spawn`, `Bun.spawnSync` and `node:child_process` returned truncated data with no error when the kernel failed a read or write on a stdio pipe with an errno like `EIO` or `ENOBUFS`. They now report the error. Found by fault injection.

<!-- https://github.com/oven-sh/bun/commit/e49f3007a7ab8f1176d2979bf5e42f09f25fb892 -->

- Fixed: on macOS and Linux, `spawnSync` or `execFileSync` could spin at 100% CPU and never return after a garbage collection during an earlier `Bun.spawnSync` freed a stream such as a previous test file's `process.stderr`. Users hit this in large `bun test --isolate` suites.

<!-- https://github.com/oven-sh/bun/commit/13a98b0dbd136bcc5c98a8adfb53c909aa3183cc -->

- Fixed: after user code closed fd 0, 1 or 2 (e.g. `fs.closeSync(1)`), `Bun.spawn` could reuse that number for its own pipes. `proc.stdout.text()` then hung if fds 0 and 1 were both closed, and on Linux a child with `stdout: "inherit"` could overwrite a `Blob` of 8 MiB or more.

<!-- https://github.com/oven-sh/bun/commit/b2ad29dc43d5c344991ad7a3397f27025350296f -->

- Fixed: on macOS, `subprocess.signalCode` and `subprocess.kill()` used Linux signal numbers, so a child killed by SIGBUS reported `"SIGUSR1"` and `kill("SIGUSR1")` sent SIGBUS. Signals numbered the same on both systems, like SIGTERM, SIGKILL and SIGINT, were not affected.

<!-- https://github.com/oven-sh/bun/commit/d7ce9b0150366ccfaf62469878ec13e955899f9b -->

- Fixed: on Linux, when the process hit its open file limit right after starting a child, `Bun.spawn` and `child_process.spawn` blocked until that child exited. A child waiting on a stdin pipe never did, which froze the process. They now fail with `EMFILE`.
- Fixed: `Bun.spawnSync` crashed the process when it ran out of file descriptors (handles on Windows) while creating its event loop on the first call. It now throws `EMFILE`.

<!-- https://github.com/oven-sh/bun/commit/f86be9d09407287f695d64e40a8a6d4fbccd683f -->

- Fixed: on macOS and Linux, when a `Bun.spawn({ terminal })` child exited with `terminal.write()` input still queued, the `Bun.Terminal` and its three pty file descriptors were never released and the process used CPU while idle. This was a regression in v1.4.0.
- Fixed: on Windows, calling `terminal.write()` after the child exited leaked the `Bun.Terminal` and its callbacks, a regression in v1.4.0.

<!-- https://github.com/oven-sh/bun/commit/90431a20126a81984f4a70ffc48a2864232e55ae -->

- Fixed: on Linux and macOS, the process never exited when code held a reader on `Bun.spawn` stdout or `Bun.stdin.stream()`, stopped calling `read()` while more than 16 KB of output was still unread, and the other end then closed.

<!-- https://github.com/oven-sh/bun/commit/14c6fda6a4a1f8bb5b532d0d5a4925168c1efc26 -->

- Fixed: a pipe-backed `FileSink` (`Bun.stdout.writer()`, `Bun.spawn` `stdin`) lost buffered data when a write was larger than the pipe could accept at once and `end()` was then called without a top-level `await`. The process exited before the reader drained the pipe.

<!-- https://github.com/oven-sh/bun/commit/3f2610e24af70b9eca8d7e8201fbfbd7e4b5051a -->

- Fixed: `Bun.file().stream()` hung instead of erroring when the underlying `read()` failed with an error like `EIO`, for example on `/proc/self/mem`. After such an error on a pty or non-blocking pipe, the process never exited.

<!-- https://github.com/oven-sh/bun/commit/b88d9369c7fea3102b4e78d133d67620f5783ce6 -->

- Fixed: on macOS, `await Bun.write(dest, Bun.file(src))` resolved to `0` instead of the byte count when `dest` already existed or was on another volume. The file itself was copied in full.

<!-- https://github.com/oven-sh/bun/commit/cab8f37fa9002e3f16343a3887c258d18f563989 -->

- Fixed: `Bun.file(path).exists()` kept returning `false` after the file was created, if an earlier `exists()` or `size` on the same `Bun.file()` had found no file.

<!-- https://github.com/oven-sh/bun/commit/bb35d1b811726bf34ef7a7505d278c32119634a8 -->

- Fixed: an `HTMLRewriter` was never garbage collected when one of its handlers referenced the rewriter or the transformed `Response`.

<!-- https://github.com/oven-sh/bun/commit/0b59724b604d9bb3bd1341747768f863eef6dce3 -->

- Fixed: `HTMLRewriter` leaked the output `Response` when an `element.onEndTag()` callback referenced it and a handler threw or the output was cancelled before that end tag.

<!-- https://github.com/oven-sh/bun/commit/403209ce23d23bcc30746f72e228a8cd5a4a9d95 -->

- Fixed: when `HTMLRewriter.transform()` read a `type: "direct"` stream body and a handler threw, the output was cancelled, or the client disconnected, the stream's `cancel()` received `undefined` and its next `write()` threw. `cancel()` now receives the reason and `write()` returns `0`.

<!-- https://github.com/oven-sh/bun/commit/9685ae9f9aca4a69610cfbd3f8a93cd12f473c62 -->

- Fixed: `Bun.Image` threw `ERR_IMAGE_DECODE_FAILED` for slightly damaged JPEGs (stray bytes, a missing end marker, truncated data) that libjpeg-turbo can decode with only a warning.

<!-- https://github.com/oven-sh/bun/commit/849da93f945a128371b4e8667375ebcd21f15f76 -->

- Fixed: in `Bun.markdown` with `wikiLinks: true`, a `*`, `_` or `~` inside a `[[target|label]]` target paired with one outside the link, leaving an unclosed `<em>`, `<strong>` or `<del>`.
- Fixed: in `Bun.markdown`, a `*` inside a reference link's label could leave an unclosed `<em>` when the link was followed by `(<` with no closing `>`, as in `*[a*](<b` with `[a*]: /url` defined.
- Fixed: in `Bun.markdown`, a backslash before a space, tab or line ending in a link destination was treated as an escape, so `[a](te\ st)` rendered as a link instead of literal text.

<!-- https://github.com/oven-sh/bun/commit/dad51772109fef9e7f551a5123a561fb1cc8b572 -->

- Fixed: `YAML.stringify()` with an indent argument left a trailing space after keys, put empty `[]` and `{}` on their own line, and misaligned nested sequences at indent widths other than 2.
- Fixed: `YAML.stringify()` could write a `*alias` in place of an unrelated object or array. This needed getters or Proxy traps that returned a new object on each read, and a garbage collection during the call.

<!-- https://github.com/oven-sh/bun/commit/d9b0bf7125dfdef34fc451f38d5323563c9491da -->

- Fixed: in a `Worker`, `Bun.TOML.stringify()` crashed instead of throwing `RangeError: Maximum call stack size exceeded` on an object nested about 9,500 levels deep, just under the depth limit. Deeper objects already threw.

<!-- https://github.com/oven-sh/bun/commit/6e1eefa337be3e3eeb24294788d9c69c92831fa6 -->

- Fixed: `Bun.wrapAnsi()` aborted the process instead of throwing a `RangeError` when an input line wrapped into tens of millions of rows or one row approached 2 GB.

<!-- https://github.com/oven-sh/bun/commit/a105560ffe7f1edbcae48e5e26737b58d1f81c2d -->

- Fixed: `Bun.stripANSI()` aborted the process on a non-Latin-1 string of 2^30 or more characters that contained an escape sequence, as did `Bun.sliceAnsi()` on about 78 million escape sequences in a row.

<!-- https://github.com/oven-sh/bun/commit/11c41c645dd6aa69e102175884052d4134eabb57 -->

- Fixed: `Bun.indexOfLine()` could miss a line break in input that is not valid UTF-8, so `for await (const line of console)` merged two lines.

<!-- https://github.com/oven-sh/bun/commit/988ce730e56dc96a221d1228d8499128e16634b8 -->

- Fixed: on Linux, `Bun.Glob` scans with `*`, `?` or `[...]` could miss file names that are not valid UTF-8, such as names from a Latin-1 archive. `bun pm pack` could also pack such a file that `.npmignore` excludes.

<!-- https://github.com/oven-sh/bun/commit/bc7a813b10b6ef8accc00c931b9a501331ac8c5c -->

- Fixed: `new Bun.FileSystemRouter()` panicked or returned truncated route names for nested files when `dir` was an absolute path containing `..`, such as `import.meta.dir + "/../pages"`.

<!-- https://github.com/oven-sh/bun/commit/95690fc53091575c727cf878d6ee055b573d5c05 -->

- Fixed: `cc()` from `bun:ffi` could crash or hang when several Workers made their first `cc()` call at the same time.

<!-- https://github.com/oven-sh/bun/commit/4224438462f9310b60887763f48ab9ec95938e55 -->

- Fixed: subclassing `Bun.Cookie`, `Bun.CookieMap`, `crypto.ECDH`, `crypto.DiffieHellman`, `dns.Resolver` or `$.Shell` returned an instance of the base class, so `instanceof` and subclass methods broke.

<!-- https://github.com/oven-sh/bun/commit/ee7e56543f3657c86ee7d8b7a58e569d12943c7e -->

- Fixed: `X509Certificate`, `crypto.hkdf`, `bun:sqlite`, and `Bun.CookieMap` aborted the process when given a non-ASCII string of 2^30 or more characters. They now throw a `RangeError` or report no match.

<!-- https://github.com/oven-sh/bun/commit/0ea0a56388ad5e261ed671c4983e9a72d49dd980 -->

### Web APIs

#### `fetch`

- Fixed: on macOS, `fetch()`, sockets and `dns.lookup()` failed with `ENOTFOUND` for split-DNS names, like a host only a VPN's resolver knows while iCloud Private Relay is on.

<!-- https://github.com/oven-sh/bun/commit/0ba17d5f7cc607262aa14e9d45ab425233fcee02 -->

- Fixed: a `fetch()` body stream (`res.body`) or `s3file.stream()` that code created, never read and dropped kept its connection if the server stopped sending mid-body. With 256 of these open at once, later `fetch()` calls stayed pending.

<!-- https://github.com/oven-sh/bun/commit/4ada08b5abee2ca74cf9ebb4c86578e3f763425b -->

- Fixed: a regression in 1.4.1 where, after more than 64 concurrent `fetch()` requests to one keep-alive origin finished, the surplus idle connections were closed with an RST, so servers logged `ECONNRESET`. The responses themselves were not affected.

<!-- https://github.com/oven-sh/bun/commit/2f3bec805e0a8b129ba262b4501ea54a5c894238 -->

- Fixed: a regression in 1.4.0 where `fetch()` leaked an ASCII string `body` when it rejected before sending, such as on an invalid header name or a `GET` with a body.

<!-- https://github.com/oven-sh/bun/commit/1f6987ca4e8a2e85dbfa4ba3e5f5830b05acb36c -->

- Fixed: `fetch()` sent the URL fragment to the server in the request line when the fragment contained a `?` and no query string came before the `#`, as in `/#/users?id=1`.
- Fixed: `delete process.env.HTTPS_PROXY` (or reassigning it after a delete) had no effect on later `fetch()` calls.
- Fixed: `fetch(url, { unix })` sent a proxy-form request down the Unix socket when `HTTP_PROXY` was set.

<!-- https://github.com/oven-sh/bun/commit/66c669c962c50112e9f4a7e6c2ca8890967d774a -->

- Fixed: a streamed `fetch()` response with `Content-Encoding: br` or `zstd` delivered only the first 4096 bytes of a larger flushed chunk, holding the rest until the next compressed chunk arrived.
- Fixed: a compressed `fetch()` body read through a stream reader over HTTP/1.1 was decompressed as fast as it arrived, not as fast as it was read. With a slow reader and an unusually compressible body, memory could grow by hundreds of MB.

<!-- https://github.com/oven-sh/bun/commit/8f8e16c5778e3b6d4116da3c25705ed1a1143b6c -->

- Fixed: `fetch()` rejected a valid `Content-Encoding: deflate` response with `ZlibError` when the server compressed with a zlib window smaller than 32 KB, or when the first read held only one byte of the body.

<!-- https://github.com/oven-sh/bun/commit/faac63e6d4b4d90807f13308785d9ced3104681f -->

- Fixed: after a `fetch()` was aborted mid-body, native readers of `res.body` such as `new Response(res.body).text()` or `Bun.write()` got a generic `AbortError` or an empty body instead of `signal.reason`.

<!-- https://github.com/oven-sh/bun/commit/6cbf91990eb263d9fa92d9731d77f7a715a67e99 -->

- Fixed: a stream taken from a `fetch()` body, `req.body`, `S3File.stream()` or `HTMLRewriter` output while the transfer was running, but first read after it had failed, ended cleanly with 0 bytes instead of rejecting. In rare cases since 1.4.0, a partly read stream crashed.

<!-- https://github.com/oven-sh/bun/commit/13b126f5bcac9cfbc3db973e0334f1aee8e053ad -->

- Fixed: a memory leak where a `fetch()` `Response` and its `AbortSignal` were never garbage collected if an `abort` listener on the signal referenced the response.

<!-- https://github.com/oven-sh/bun/commit/dc30df045379e43a6bc3b54151fe5f42968313a2 -->

- Fixed: after `req.clone()` in `Bun.serve` or `res.clone()` on a `fetch()` response, a reader on the original's `body` stream ended with `done: true` instead of rejecting when the body failed mid-stream. `text()` and the clone already rejected.

<!-- https://github.com/oven-sh/bun/commit/8d210803ed0244105147403ed9eb438823ffbb4f -->

- Fixed: `arrayBuffer()` and `bytes()` on a `fetch()` response or `Response` whose body exceeded 4 GiB aborted the process instead of rejecting with `RangeError: Out of memory`.

<!-- https://github.com/oven-sh/bun/commit/7e8bac107879afa2c55613824d0abed39a442e82 -->

- Fixed: over HTTP/2 and HTTP/3, `fetch()` kept leading and trailing whitespace on a response header value when the server sent it, which the HTTP/2 spec forbids. A padded `Location` header failed to redirect.

<!-- https://github.com/oven-sh/bun/commit/b8c4a9b629e55d691c38c548f619e9ed50a2ac58 -->

- Fixed: `fetch()` with `protocol: "http3"` crashed when the QUIC connection closed before the response headers arrived and the automatic retry could not open a new connection at all, such as when no address for the host was reachable.
- Fixed: aborting an HTTP/3 `fetch()` upload made the server treat the truncated body as complete. If the request declared a `content-length`, the server closed the connection and the next upload to that origin could reject with `HTTP3StreamReset`.
- Fixed: HTTP/3 `fetch()` and `Bun.serve({ http3: true })` spun at 100% CPU when the kernel kept refusing UDP sends, such as under a firewall DROP rule or a low egress MTU.

<!-- https://github.com/oven-sh/bun/commit/b27413b4a95cd4452a07e4745b35a113af86be96 -->

#### `WebSocket`

- Fixed: the `WebSocket` client reported close code `1005` or a `1002` protocol error when the server's Close frame was split across two TCP reads within its first three bytes.

<!-- https://github.com/oven-sh/bun/commit/e608cd451786d3066e593bd6d732e86314deba58 -->

- Fixed: a `wss://` WebSocket through an HTTP CONNECT proxy reported close code 1006 "Failed to write" instead of the server's close code when the server ended TLS right behind its Close frame, as `ws.close()` in `Bun.serve` does.

<!-- https://github.com/oven-sh/bun/commit/91d89f41f4ed539351dc9b660ae6bb7167fdbd3d -->

- Fixed: a `wss://` WebSocket to an IP address such as `127.0.0.1`, or through an HTTPS proxy at an IP address, closed with code 1006 when a TLS 1.2 server renegotiated (regression in 1.4.1).

<!-- https://github.com/oven-sh/bun/commit/6683f741f085f037921eb7cb0dfcf8eebf4ab2ca -->

#### Streams

- Fixed: `controller.write()` in a `type: "direct"` `ReadableStream` never waited for a slow reader using `getReader()`, `for await` or `pipeTo()`. Once unread bytes reach `highWaterMark` (64 KiB by default), it now returns a promise that resolves on the next read.
- Fixed: a direct stream's `cancel(reason)` was never called on `reader.cancel()`, `stream.cancel()`, or a `break` out of `for await`.
- Fixed: in a direct stream, a `write()` made after `end()` or `close()` inside `pull()` was still delivered to the reader.
- Fixed: `bytes()` and `arrayBuffer()` hung on a direct stream whose async `pull()` called `controller.end()` and never returned.
- Fixed: `Duplex.fromWeb` dropped the last chunk of a `type: "direct"` `ReadableStream` when `pull()` called `controller.error()` or threw right after flushing that chunk. Only the `error` event was emitted.

<!-- https://github.com/oven-sh/bun/commit/3cb2fa7eff11e5157dc863c23415e89555bf9035 -->

- Fixed: an async-iterable body (`new Response(asyncGen())`, a `fetch` upload, a `Bun.serve` response) was silently truncated or hung when the generator threw an error with code `ERR_INVALID_THIS`, instead of failing the stream.

<!-- https://github.com/oven-sh/bun/commit/320c84c20e7f389da0ccdd58cf62abb33775d762 -->

- Fixed: `new Response(asyncIterable)` kept pulling the iterator after its consumer had stopped early, through `reader.cancel()`, a `break` out of `for await`, a failed `pipeTo()`, or a `Bun.write()` that hit `ENOSPC`. It now calls the iterator's `return()`, so `finally` blocks run.

<!-- https://github.com/oven-sh/bun/commit/9e31db2f3e5f0502ee224edc54a10d8eb7ab93f5 -->

- Fixed: `finished(stream)` from `node:stream/promises` never settled for a `fetch()` body or `Bun.file()` stream consumed natively (by `Bun.write()`, a `fetch()` request body, `Bun.serve()`, spawn stdin, or S3). The stream stayed `readable`.
- Fixed: for a `Response` body backed by a string, `Blob`, typed array or file, reading `res.body` and then calling `arrayBuffer()`, `bytes()`, `blob()`, `json()` or `formData()` left the stream `readable`, so `finished(body)` from `node:stream/promises` never settled.
- Fixed: a `res.body` stream taken before `await res.text()` (or `json()`, `blob()`, etc.) was left unlocked afterwards and `getReader()` still worked, unlike undici and browsers.

<!-- https://github.com/oven-sh/bun/commit/f04caca828a9edd4af48147f88afe2b7e6977111 -->

- Fixed: reading `blob.slice(start, end).stream()` with `.text()`, `.bytes()`, `.json()` or `Bun.readableStreamToText()` returned the whole parent `Blob` if the parent and the slice had already been garbage-collected.

<!-- https://github.com/oven-sh/bun/commit/e29a7ca47cb31c58c9651287af567c705c036ca2 -->

- Fixed: `ReadableStream` `cancel()`, `pipeTo()` and `pipeThrough()` on a locked stream threw a `TypeError` without `code: "ERR_INVALID_STATE"`, a regression from 1.3.

<!-- https://github.com/oven-sh/bun/commit/30787ebeab72b1656df47ffdb5d1446042c776b5 -->

- Fixed: web streams aborted the process instead of throwing `RangeError: Out of memory` when a queue or buffer hit its size limit, such as 67 million chunks queued and not yet read, or a single 2 GiB chunk (since 1.4.0).

<!-- https://github.com/oven-sh/bun/commit/ac0e813bada25462d9a39fa3fe0355e39c8e01bb -->

#### Other

- Fixed: `postMessage()` detached the `ArrayBuffer`s in its transfer list even when it threw `DataCloneError` because a getter in the message closed a transferred `MessagePort`.

<!-- https://github.com/oven-sh/bun/commit/49c076eb9ed320a7a84861175f7c3e88e410cf3d -->

### TLS

- Fixed: `fetch()`, `WebSocket`, and `Bun.SQL` with `sslmode=verify-full` failed certificate verification when connecting to an IPv6 literal like `https://[::1]:3000`, even when the cert had a matching IP SAN. `fetch()` rejected with `ERR_TLS_CERT_ALTNAME_INVALID`.

<!-- https://github.com/oven-sh/bun/commit/81b7f41e5f38b09abb955d157867e4c125e00a62 -->

- Fixed: a `Bun.connect` TLS socket that called `shutdown()` mid-handshake never fired `close` after `end()` while the peer stayed connected. The next socket to do the same never got its `handshake` callback.
- Fixed: on a `Bun.listen()` TLS server, `socket.pause()` did not hold for a connection whose handshake was queued because many handshakes arrived at once. `handshake` and `data` still fired on it.

<!-- https://github.com/oven-sh/bun/commit/a11362e3650c1610c21e7b38556efa50a7290495 -->

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

### bun build --compile

- Fixed: on Linux, `bun build --compile` run from inside a compiled executable (`BUN_BE_BUN=1` or `Bun.build({ compile })`) wrote an executable that crashed at startup, a regression since v1.3.14.

<!-- https://github.com/oven-sh/bun/commit/38acc2018d047cc7bcd0b5cfd2869bee169d7f5f -->

- Fixed: `bun build --compile --bytecode --format=esm --splitting` wrote an executable that differed by a few bytes on every run from the same inputs, breaking reproducible builds. The executables ran the same.

<!-- https://github.com/oven-sh/bun/commit/ce637e70f65a0693eac3336cfc324ec07c4d3b0c -->

- Fixed: with `bytecode: true`, `Bun.build` returned an `undefined` output and dropped the last asset when a chunk could not be compiled to bytecode, such as one with an invalid `\p{...}` regex.
- Fixed: a `--compile --bytecode` executable that had called `inspector.open()` crashed when a debugger client connected.

<!-- https://github.com/oven-sh/bun/commit/ba1faad3372ebd63f0f15606bbb4ab48f3a7d15d -->

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

### Bun Shell

- Fixed: in Bun Shell, a pipeline command that failed with a JavaScript error before it started, such as a redirect into a `Response` (`cmd | cat > ${new Response("r")}`), left the other commands running and the process never exited.

<!-- https://github.com/oven-sh/bun/commit/d513feb46ed9ad02618e611f9d3386500cfb7739 -->

- Fixed: a Bun Shell command with `< ${buffer}` stdin never finished when the buffer was larger than the pipe buffer, the command exited without reading it, and a background process it had started still held stdin open.

<!-- https://github.com/oven-sh/bun/commit/3e3637716f982095a76f41c65fb12dc914873cf4 -->

- Fixed: Bun Shell's `.then()` and `.catch()` threw synchronously instead of returning a rejected promise when the shell failed to start, such as `.cwd()` to a missing directory. Code that used `await` saw an ordinary rejection either way.

<!-- https://github.com/oven-sh/bun/commit/0d0b28b906727a232caf9993a0c05e6ac70548bd -->

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

### Windows

- Fixed: on Windows 10 and 11, `process.report.getReport().header.osRelease` read `6.1` instead of `10.0`.

<!-- https://github.com/oven-sh/bun/commit/2f09e6d266b0d35483f4fd6121f18578a183dfd1 -->

- Fixed: on Windows, `Bun.connect()` to a named pipe leaked a small amount of memory each time the connect failed synchronously, such as with an invalid `tls` certificate.

<!-- https://github.com/oven-sh/bun/commit/a749e0a9b662b06ce3f5d63e967ef31a7d202239 -->
