---
source: index of this snapshot (oven-sh/bun docs @ c39c718b44107075481f80a9267259059565d504 + bun.com blog)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504
---

# Bun docs snapshot for React Native / Expo on Bun

Offline copy of the official Bun documentation (latest Bun: 1.4.3, released 2026-10-10). The doc pages are the raw MDX from `oven-sh/bun` `docs/` at commit `c39c718b44107075481f80a9267259059565d504` (main, 2026-10-12T05:17:05Z). Only the frontmatter was changed: it became a heading and a description quote. MDX components (`<Note>`, `<Tabs>`, `<ParamField>`) are left as they were. Pages that `import` a CLI snippet have a comment pointing at the saved `snippets__cli__*.md` file. Blog posts come from `https://bun.com/blog/<slug>.md`. Large posts are saved as excerpts, and full verbatim copies are in `blog-full/`.

File naming: the docs path with `/` replaced by `__` (for example `docs/pm/cli/install.mdx` becomes `pm__cli__install.md`).

| File | Title | Source | Why it matters for React Native on Bun |
| --- | --- | --- | --- |
| [pm__cli__install.md](pm__cli__install.md) | bun install | https://bun.com/docs/pm/cli/install | Core install flags, linker default by configVersion, pnpm migration, env vars; the command every RN/Expo install runs. |
| [snippets__cli__install.md](snippets__cli__install.md) | bun install — CLI flag reference (snippet) | https://bun.com/docs/pm/cli/install | Exhaustive flag list (--frozen-lockfile, --linker, --ignore-scripts, --production) for CI scripts. |
| [pm__lockfile.md](pm__lockfile.md) | Lockfile | https://bun.com/docs/pm/lockfile | bun.lock text format and migration from yarn.lock / package-lock.json / pnpm-lock.yaml. |
| [pm__isolated-installs.md](pm__isolated-installs.md) | Isolated installs | https://bun.com/docs/pm/isolated-installs | Hoisted vs isolated linker, configVersion defaults, publicHoistPattern; Metro/Expo autolinking depend on node_modules layout. |
| [pm__global-store.md](pm__global-store.md) | Global virtual store | https://bun.com/docs/pm/global-store | globalStore option for isolated installs; symlinked store may confuse Metro watchers/native autolinking. |
| [pm__global-cache.md](pm__global-cache.md) | Global cache | https://bun.com/docs/pm/global-cache | BUN_INSTALL_CACHE_DIR and cache location; needed for CI caching. |
| [pm__workspaces.md](pm__workspaces.md) | Workspaces | https://bun.com/docs/pm/workspaces | Monorepo setup typical for Expo apps plus shared packages. |
| [pm__lifecycle.md](pm__lifecycle.md) | Lifecycle scripts | https://bun.com/docs/pm/lifecycle | trustedDependencies semantics (replaces default list); postinstall of native/RN deps won't run unless trusted. |
| [default-trusted-dependencies.md](default-trusted-dependencies.md) | Default trusted dependencies list | https://github.com/oven-sh/bun/blob/main/src/install/default-trusted-dependencies.txt | The actual allowlist (few RN packages on it); shows what needs explicit trust. |
| [guides__install__trusted.md](guides__install__trusted.md) | Add a trusted dependency | https://bun.com/docs/guides/install/trusted | How to `bun pm trust` packages whose postinstall RN tooling needs. |
| [pm__cli__pm.md](pm__cli__pm.md) | bun pm | https://bun.com/docs/pm/cli/pm | bun pm trust / untrusted / migrate / ls / cache commands. |
| [pm__cli__patch.md](pm__cli__patch.md) | bun patch | https://bun.com/docs/pm/cli/patch | Patching RN libraries (patch-package replacement). |
| [snippets__cli__patch.md](snippets__cli__patch.md) | bun patch — CLI flag reference (snippet) | https://bun.com/docs/pm/cli/patch | Flag details for bun patch / --commit. |
| [pm__overrides.md](pm__overrides.md) | Overrides and resolutions | https://bun.com/docs/pm/overrides | Pinning transitive deps (common RN version-conflict fix); yarn resolutions support. |
| [pm__catalogs.md](pm__catalogs.md) | Catalogs | https://bun.com/docs/pm/catalogs | Sharing react / react-native versions across monorepo workspaces. |
| [pm__npmrc.md](pm__npmrc.md) | .npmrc support | https://bun.com/docs/pm/npmrc | Which .npmrc keys Bun honors (node-linker, registries, auth) when migrating from npm/pnpm. |
| [pm__scopes-registries.md](pm__scopes-registries.md) | Scopes and registries | https://bun.com/docs/pm/scopes-registries | Private/scoped registry config for internal RN packages. |
| [pm__filter.md](pm__filter.md) | bun --filter | https://bun.com/docs/pm/filter | Running scripts across workspace packages. |
| [pm__bunx.md](pm__bunx.md) | bunx | https://bun.com/docs/pm/bunx | Running expo / react-native CLIs via bunx, incl. --bun shebang override. |
| [guides__install__cicd.md](guides__install__cicd.md) | Install dependencies with Bun in GitHub Actions | https://bun.com/docs/guides/install/cicd | CI install recipe for app pipelines. |
| [guides__install__from-npm-install-to-bun-install.md](guides__install__from-npm-install-to-bun-install.md) | Migrate from npm install to bun install | https://bun.com/docs/guides/install/from-npm-install-to-bun-install | Migration checklist from npm, incl. --bun and node_modules differences. |
| [guides__install__yarnlock.md](guides__install__yarnlock.md) | Generate a yarn-compatible lockfile | https://bun.com/docs/guides/install/yarnlock | Keeping a yarn.lock for tools (e.g. EAS/legacy CI) that expect one. |
| [guides__install__workspaces.md](guides__install__workspaces.md) | Configuring a monorepo using workspaces | https://bun.com/docs/guides/install/workspaces | Step-by-step monorepo guide. |
| [guides__install__git-diff-bun-lockfile.md](guides__install__git-diff-bun-lockfile.md) | Configure git to diff Bun's lockb lockfile | https://bun.com/docs/guides/install/git-diff-bun-lockfile | Legacy bun.lockb diffing (only relevant for old binary lockfiles). |
| [runtime__bunfig.md](runtime__bunfig.md) | bunfig.toml | https://bun.com/docs/runtime/bunfig | Full config reference: preload, [install] linker/peer/exact/registry, [run] bun = true, [test] preload/root/coverage. |
| [runtime__index.md](runtime__index.md) | Bun Runtime (bun run) | https://bun.com/docs/runtime | bun run semantics and --bun (shebang override) for running Expo/Metro CLIs on Bun. |
| [snippets__cli__run.md](snippets__cli__run.md) | bun run — CLI flag reference (snippet) | https://bun.com/docs/runtime | --bun (node symlink), --preload, --env-file, --filter, --parallel flags. |
| [runtime__nodejs-compat.md](runtime__nodejs-compat.md) | Node.js Compatibility | https://bun.com/docs/runtime/nodejs-compat | Per-module Node API status; Metro, Babel, Jest workers rely on fs, worker_threads, child_process, vm. |
| [runtime__environment-variables.md](runtime__environment-variables.md) | Environment Variables | https://bun.com/docs/runtime/environment-variables | .env loading order, BUN_OPTIONS and Bun-specific env vars (NODE_OPTIONS not documented here). |
| [guides__runtime__read-env.md](guides__runtime__read-env.md) | Read environment variables | https://bun.com/docs/guides/runtime/read-env | process.env / Bun.env basics for EXPO_PUBLIC_* style config. |
| [guides__runtime__set-env.md](guides__runtime__set-env.md) | Set environment variables | https://bun.com/docs/guides/runtime/set-env | Setting env vars and .env files for app scripts. |
| [runtime__plugins.md](runtime__plugins.md) | Plugins (runtime) | https://bun.com/docs/runtime/plugins | Bun.plugin onLoad/onResolve; how to teach Bun to load Flow/RN-specific files when running tooling. |
| [bundler__plugins.md](bundler__plugins.md) | Plugins (bundler) | https://bun.com/docs/bundler/plugins | Shared plugin API reference (builder, onStart/onLoad/onResolve details). |
| [runtime__workers.md](runtime__workers.md) | Workers | https://bun.com/docs/runtime/workers | Worker API incl. preload option; Metro/jest-worker use worker_threads. |
| [runtime__child-process.md](runtime__child-process.md) | Spawn (child processes) | https://bun.com/docs/runtime/child-process | Bun.spawn/spawnSync; RN CLI shells out to xcodebuild/gradle/adb. |
| [guides__process__spawn.md](guides__process__spawn.md) | Spawn a child process | https://bun.com/docs/guides/process/spawn | Short spawn recipe. |
| [guides__process__argv.md](guides__process__argv.md) | Parse command-line arguments | https://bun.com/docs/guides/process/argv | process.argv/Bun.argv shape, which CLIs like expo parse. |
| [guides__read-file__watch.md](guides__read-file__watch.md) | Watch a directory for changes | https://bun.com/docs/guides/read-file/watch | fs.watch behavior (shallow by default, recursive option); Metro's file watcher depends on it. |
| [runtime__module-resolution.md](runtime__module-resolution.md) | Module Resolution | https://bun.com/docs/runtime/module-resolution | ESM/CJS interop, package exports and conditions; relevant to RN packages' "react-native" field. |
| [runtime__watch-mode.md](runtime__watch-mode.md) | Watch Mode | https://bun.com/docs/runtime/watch-mode | --watch / --hot semantics for dev scripts. |
| [test__index.md](test__index.md) | Test runner | https://bun.com/docs/test | bun test overview and Jest compatibility. |
| [snippets__cli__test.md](snippets__cli__test.md) | bun test — CLI flag reference (snippet) | https://bun.com/docs/test | All bun test flags (--preload, --coverage, --isolate, --parallel). |
| [test__configuration.md](test__configuration.md) | Test configuration | https://bun.com/docs/test/configuration | bunfig [test] section: preload, root, coverage. |
| [test__mocks.md](test__mocks.md) | Mocks | https://bun.com/docs/test/mocks | mock.module and jest.mock compatibility; needed to mock react-native native modules. |
| [test__lifecycle.md](test__lifecycle.md) | Lifecycle hooks | https://bun.com/docs/test/lifecycle | beforeAll/afterEach and preload setup files (jest setupFiles equivalent). |
| [test__code-coverage.md](test__code-coverage.md) | Code coverage | https://bun.com/docs/test/code-coverage | Coverage reporters/thresholds for CI. |
| [test__snapshots.md](test__snapshots.md) | Snapshots | https://bun.com/docs/test/snapshots | Snapshot testing of rendered RN components. |
| [test__discovery.md](test__discovery.md) | Finding tests | https://bun.com/docs/test/discovery | Test file patterns and root; avoiding node_modules / native dirs. |
| [test__runtime-behavior.md](test__runtime-behavior.md) | Runtime behavior | https://bun.com/docs/test/runtime-behavior | NODE_ENV, TZ, CI strictness, env during tests. |
| [test__dom.md](test__dom.md) | DOM testing | https://bun.com/docs/test/dom | happy-dom setup; relevant to react-native-web/Expo web tests. |
| [test__parallel.md](test__parallel.md) | Parallel & isolated test runs | https://bun.com/docs/test/parallel | --parallel / --isolate for jest-like per-file isolation. |
| [guides__test__migrate-from-jest.md](guides__test__migrate-from-jest.md) | Migrate from Jest to Bun's test runner | https://bun.com/docs/guides/test/migrate-from-jest | What maps 1:1 from Jest (jest-expo/react-native preset users need this). |
| [guides__test__testing-library.md](guides__test__testing-library.md) | Using Testing Library with Bun | https://bun.com/docs/guides/test/testing-library | Testing Library setup via preload. |
| [guides__test__coverage-threshold.md](guides__test__coverage-threshold.md) | Set a code coverage threshold | https://bun.com/docs/guides/test/coverage-threshold | CI coverage gates. |
| [guides__runtime__cicd.md](guides__runtime__cicd.md) | Install and run Bun in GitHub Actions | https://bun.com/docs/guides/runtime/cicd | oven-sh/setup-bun usage for CI. |
| [guides__ecosystem__docker.md](guides__ecosystem__docker.md) | Containerize a Bun application with Docker | https://bun.com/docs/guides/ecosystem/docker | Docker recipe with --frozen-lockfile (useful for build/CI images). |
| [blog__bun-v1.4.md](blog__bun-v1.4.md) | Bun 1.4 (excerpt) | https://bun.com/blog/bun-v1.4 | Release notes: Node 26 compat, install changes, lockfileVersion 2, upgrading/breaking changes. |
| [blog__bun-v1.4.1.md](blog__bun-v1.4.1.md) | Bun v1.4.1 (excerpt) | https://bun.com/blog/bun-v1.4.1 | Self-contained workspace node_modules, --offline installs, Node compat fixes. |
| [blog__bun-v1.4.2.md](blog__bun-v1.4.2.md) | Bun v1.4.2 (full) | https://bun.com/blog/bun-v1.4.2 | Small regression-fix release (AsyncLocalStorage, JIT/GC crashes); nothing install/linker-specific, saved whole for completeness. |
| [blog__bun-v1.4.3.md](blog__bun-v1.4.3.md) | Bun v1.4.3 (excerpt) | https://bun.com/blog/bun-v1.4.3 | Latest release (1.4.3): install/runtime/Node compat fixes. |
| [blog__bun-v1.3.md](blog__bun-v1.3.md) | Bun 1.3 (excerpt) | https://bun.com/blog/bun-v1.3 | Isolated installs default for workspaces, catalogs, pnpm/yarn migration, Worker improvements, BUN_OPTIONS. |
| [blog__bun-v1.3.2.md](blog__bun-v1.3.2.md) | Bun v1.3.2 (full) | https://bun.com/blog/bun-v1.3.2 | Hoisted default restored for existing projects (configVersion) — the isolated-default rule. |
| [blog-full/bun-v1.4.md](blog-full/bun-v1.4.md) | bun-v1.4 (full post, verbatim) | https://bun.com/blog/bun-v1.4 | Unfiltered post, to check context beyond the excerpt. |
| [blog-full/bun-v1.4.1.md](blog-full/bun-v1.4.1.md) | bun-v1.4.1 (full post, verbatim) | https://bun.com/blog/bun-v1.4.1 | Unfiltered post, to check context beyond the excerpt. |
| [blog-full/bun-v1.4.2.md](blog-full/bun-v1.4.2.md) | bun-v1.4.2 (full post, verbatim) | https://bun.com/blog/bun-v1.4.2 | Unfiltered post, to check context beyond the excerpt. |
| [blog-full/bun-v1.4.3.md](blog-full/bun-v1.4.3.md) | bun-v1.4.3 (full post, verbatim) | https://bun.com/blog/bun-v1.4.3 | Unfiltered post, to check context beyond the excerpt. |
| [blog-full/bun-v1.3.md](blog-full/bun-v1.3.md) | bun-v1.3 (full post, verbatim) | https://bun.com/blog/bun-v1.3 | Unfiltered post, to check context beyond the excerpt. |
| [blog-full/bun-v1.3.2.md](blog-full/bun-v1.3.2.md) | bun-v1.3.2 (full post, verbatim) | https://bun.com/blog/bun-v1.3.2 | Unfiltered post, to check context beyond the excerpt. |

## Not found in official docs

- `NODE_OPTIONS`: no Bun docs page or blog post here documents how Bun handles it.
- There is no separate "nodejs-apis" page. Node API status is in `runtime__nodejs-compat.md`.
- `fs.watch` has no dedicated reference page. It is covered by the short guide `guides__read-file__watch.md` and by Node-compat notes.
