<img src="assets/icon.svg" width="64" height="64" alt="">

# bun react native

Expo (SDK 57) / React Native 0.86 app whose whole toolchain runs on **Bun** instead of Node.js:
package installs, Expo CLI, Metro, Babel, Jest, ESLint, TypeScript, CocoaPods/Gradle/Xcode build steps and CI.
On the device the JavaScript still runs on Hermes.

Created in [T3 Code](https://t3.codes).

## Requirements

- Bun **1.4.3** (`packageManager` in `package.json`)
- Xcode + CocoaPods (iOS), JDK 17 + Android SDK (Android)
- No Node.js needed — `tools/bin/node` is a `node` → Bun shim

## Setup

```bash
export PATH="$PWD/tools/bin:$PATH"   # put this (with an absolute path) in your shell profile
node -p "process.versions.bun"       # must print the Bun version, not `undefined`
bun install
```

## Commands

Run scripts with `bun run …` / `bun expo …` — **never with `--bun`** (it puts Bun's buggy `node` alias in front of
the shim for child processes; see `docs/bun-react-native/KNOWN-ISSUES.md`).

```bash
bun run start        # Metro (on Bun)
bun run ios          # expo run:ios
bun run android      # expo run:android
bun run typecheck
bun run lint
bun run test         # Jest on the Bun runtime
bun run prebuild     # expo prebuild --clean (ios/ and android/ are generated, not committed)
```

## How it works

| File | Purpose |
|---|---|
| `tools/bin/node` | `node` → Bun shim used by Podfile, Gradle, autolinking and Expo/RN scripts |
| `bunfig.toml` | preloads the Node-compat shims, hoisted linker, npm registry |
| `tools/bun/node-compat.preload.js` | sorts `fs.readdir*` like Node, so Metro output is byte-identical to Node's |
| `tools/bun/jest.preload.js` | lets Jest run on Bun (hides `vm.SyntheticModule`) |
| `metro.config.js` | runs Metro transform workers as processes under Bun (preloads do not reach `worker_threads`) |
| `plugins/with-bun-xcode-env.js` | config plugin: `ios/.xcode.env` → `NODE_BINARY=$(command -v bun)` |
| `eas.json`, `eas-build-*` scripts | Bun version for EAS Build and the shim on the EAS worker PATH (unverified on EAS) |
| `.github/workflows/mobile-bun.yml` | CI: checks, Android and iOS release builds, Node-vs-Bun bundle determinism |

Full documentation, verification results and the official docs snapshot: [`docs/bun-react-native/`](docs/bun-react-native/README.md).
