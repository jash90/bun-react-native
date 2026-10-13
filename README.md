<img src="example/assets/icon.svg" width="64" height="64" alt="">

# bun-react-native

Run the whole Expo / React Native toolchain on **Bun** instead of Node.js: Expo CLI, Metro, Babel, Jest, ESLint,
type checking, and the JavaScript steps of CocoaPods, Gradle and Xcode builds. On the device the JavaScript still
runs on Hermes.

- **Metro on the Bun runtime** is the default bundler. Its output is byte-identical to Metro on Node.js: release
  bundles, source maps, assets, dev bundles and HMR updates. CI compares release and web bundles with Node.js on
  every change.
- **An optional Bun bundler** (`RN_BUNDLER=bun`) replaces Metro with a bundler built on Bun's APIs. Projects it
  cannot take, such as React Server Components or unsupported `metro.config.js` changes, stay on Metro.
- **No script changes.** You keep using `bun expo start`, `bun expo run:ios`, `bun expo export` and `bun run test`.

Verified with Bun 1.4.3 on Expo SDK 57 (React Native 0.86), and on SDK 58 (`expo@next`, React Native 0.88 RC) for
Metro on Bun. The Bun bundler (`RN_BUNDLER=bun`) supports SDK 57; on SDK 58 it falls back to Metro.

Created in [T3 Code](https://t3.codes).

## Install

```bash
bun add -d github:jash90/bun-react-native   # npm publication comes with v1
bunx bun-react-native init                  # bunfig.toml, config plugin, EAS hook - then checks the setup
bun install
```

`init` is idempotent. It makes these changes:

| File | Change |
|---|---|
| `bunfig.toml` | `preload = ["bun-react-native/preload"]` and `env = false`; `[install] linker = "hoisted"` if the file has no `[install]` table |
| `app.json` | adds the `"bun-react-native"` config plugin; with `app.config.js` it prints the line to add |
| `eas.json` / `package.json` | Bun version for EAS Build; an `eas-build-post-install` hook that puts the `node` shim on PATH |

It also prints what you have to do yourself, for example removing an old `package-lock.json` after `bun install`
has migrated it. `bunx bun-react-native doctor` checks the setup at any time and shows which engine bundles the app.

## Use

```bash
bun expo start                 # dev server (Expo Go, dev clients, web), Metro on Bun
bun expo run:ios               # native builds; the JS steps run on Bun
bun expo export                # iOS/Android (EAS Update layout) + web
bun run test                   # Jest on the Bun runtime
bun check                      # Bun's type checker (same errors as tsc --noEmit)
RN_BUNDLER=bun bun expo start  # the Bun bundler instead of Metro (also for export, export:embed, run:*)
```

Never use `bun --bun` or `[run] bun = true`. Both put Bun's own `node` alias in front of the package's shim, and
that alias breaks autolinking ([oven-sh/bun#40482](https://github.com/oven-sh/bun/issues/40482)).

## How it works

| Piece | What it does |
|---|---|
| `preload.js` (bunfig preload) | loads in every Bun process started in the app directory: Expo CLI, Metro, Jest, and the Gradle/Xcode bundle steps |
| `tools/bun/path.preload.js` | puts the `node` → Bun shim (`tools/bin/node`) first on PATH for child processes: Gradle, CocoaPods, autolinking |
| `tools/bun/node-compat.preload.js` | Node behaviour Metro and Expo depend on: sorted `fs.readdir*` ([#44947](https://github.com/oven-sh/bun/issues/44947)), `util.parseEnv` key order, `net.Server#listen` callback ([#45090](https://github.com/oven-sh/bun/issues/45090)) |
| `tools/bun/jest.preload.js` | makes Jest under Bun behave as it does under Node |
| `tools/bun-bundler/metro-on-bun.ts` | Metro transform workers as Bun processes that load the preload, `EXPO_PUBLIC_*` in cache keys, Bun's minifier for web, RSC dev polyfill |
| `tools/bun/expo-export-order.js` | deterministic `expo export`: platform and DOM component bundles one after another and the web render function before the client bundle (no measurable cost), so module IDs and bundle hashes do not depend on Expo's parallel-bundling race (on Node too); `BUN_RN_EXPORT_ORDER=0` turns it off |
| `tools/bun-bundler/` | the optional Bun bundler: Expo/Metro resolver chain, Babel worker pool, CSS, assets, dev server with HMR, exports ([BUNDLER.md](docs/bun-react-native/BUNDLER.md)) |
| `app.plugin.js` | Xcode script phases use Bun (`NODE_BINARY` in `ios/.xcode.env`) |
| `tools/cli/` | `init`, `doctor`, `compare`, `eas-build-post-install` |

Android Studio and Xcode started from the Dock do not get your shell's PATH. Xcode is covered by `NODE_BINARY`.
Gradle runs `node` from PATH, so start Android builds with `bun expo run:android`, or put
`node_modules/bun-react-native/tools/bin` on PATH.

## This repository

The package lives at the repository root. `example/` is an Expo app that uses it through a symlink
(`node_modules/bun-react-native`).

```bash
bun install          # workspace install; links the package into the example app
bun test             # the package's own tests (tools/)
cd example && bun expo start
```

Documentation, verification results and the decisions behind them: [`docs/bun-react-native/`](docs/bun-react-native/README.md)
(in Polish), including [KNOWN-ISSUES.md](docs/bun-react-native/KNOWN-ISSUES.md).

## License

MIT, see [LICENSE](LICENSE). `docs/bun-react-native/sources/` holds copies of third-party documentation
(Bun, Expo/EAS, Metro, React Native) kept for reference; they stay under their projects' own licenses.
