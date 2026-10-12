This repository is the `bun-react-native` package (repository root: `preload.js`, `app.plugin.js`, `tools/`) and an
Expo/React Native example app that uses it (`example/`). In the app, prioritize mobile-first patterns, performance, and
cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `example/package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `example/src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `example/src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Bun toolchain (this repo runs without Node.js)

- Install from the repo root (`bun install`: workspace with `example/`; its postinstall links the package into
  `node_modules/bun-react-native`). Run app commands in `example/` as `bun expo …` / `bun run <script>`, package tests at
  the root with `bun test`. **Never add `--bun`** and never set `[run] bun = true`: both put Bun's `node` alias
  (oven-sh/bun#40482) in front of the shim and break autolinking in Gradle/CocoaPods.
- `preload.js` (bunfig `preload = ["bun-react-native/preload"]` in an app) loads into every Bun process in the app
  directory: `tools/bun/path.preload.js` (node -> Bun shim `tools/bin/node` first on PATH for child processes),
  `node-compat.preload.js` (sorted readdir, util.parseEnv order, net listen callback - KNOWN-ISSUES #4/#5, #18, #19),
  `jest.preload.js`, `expo-cli.preload.js` (`tools/bun-bundler/metro-on-bun.ts` for every Expo CLI process: Metro
  transforms on Bun threads with the shims, EXPO_PUBLIC_* in cache keys, Bun's minifier for web, RSC dev polyfill;
  Metro internals from Expo CLI's copy via `tools/bun/metro-require.js`).
- Engine: **Metro on the Bun runtime by default** (byte-identical to Metro on Node; CI `bundle-determinism`).
  `RN_BUNDLER=bun` routes `expo start|run:*|export|export:embed` and expo-updates' build step to the Bun bundler
  (`tools/bun-bundler/`: Bun.build + Metro-equivalent resolver + Expo Babel transform; dev server with Metro's own
  Transformer/serializer for native, so dev bundles, maps and HMR are Metro's byte for byte). Projects with React Server
  Components or `metro.config.js` customizations beyond `sourceExts`/`assetExts`/`babelTransformerPath` stay on Metro
  (`tools/bun-bundler/metro-config-support.ts`). Details: `docs/bun-react-native/BUNDLER.md`.
- `tools/bun/metro-minifier.js` replaces terser in Metro (web exports; `METRO_BUN_MINIFIER=0` keeps terser); after
  changing it run `bun test` and check `hermesc` still compiles a minified bundle.
- After changing bundling code: `bun test`, in `example/` bundle both platforms (`bun expo export:embed`), compile with
  `hermesc`, compare with Metro on real Node (separate TMPDIR per runtime), `RN_BUNDLER=bun bun expo export` vs
  `bun expo export` with `bunx bun-react-native compare`, and check web in a browser.
- `tools/cli/` is the `bun-react-native` CLI (`init`, `doctor`, `compare`, `eas-build-post-install`); `app.plugin.js`
  sets Xcode's NODE_BINARY to Bun. Keep files under 500 lines.
- `.env` files are loaded by Expo CLI / the bundler for the command's mode (`tools/bun-bundler/env.ts`); Bun's own
  automatic `.env` loading stays off (`env = false` in bunfig, `--no-env-file` in the shim).
- `bun.lock` must reference the default registry (`""`); the root `bunfig.toml` pins `https://registry.npmjs.org/`.
