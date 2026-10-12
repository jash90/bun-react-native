This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
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

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
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

- `tools/bin/node` is a `node` → Bun shim and must be first on `PATH` (`node -p "process.versions.bun"` prints a version).
- Run everything as `bun run <script>` / `bun expo …` / `bun x …`. **Never add `--bun`** and never set `[run] bun = true`:
  both put Bun's `node` alias (oven-sh/bun#40482) in front of the shim and break autolinking in Gradle/CocoaPods.
- Keep `bunfig.toml`, `tools/bun/*.preload.js` and the `unstable_workerThreads` switch in `metro.config.js` — they make
  unminified Metro output byte-identical to Node's and let Jest run on Bun. Details: `docs/bun-react-native/RUNBOOK.md`.
- `tools/bun/metro-minifier.js` replaces terser under Bun (only used when Metro minifies, i.e. web exports); after
  changing it run `bun run test:tools` and check `hermesc` still compiles a minified bundle.
- Bundling uses `tools/bun-bundler/` (Bun.build + Metro-equivalent resolver + Expo Babel transform) instead of Metro:
  native release builds call `tools/bun-bundler/cli.ts` via `plugins/with-bun-bundler.js`; `bun run start` is its dev
  server for iOS/Android/web (Metro module format, lazy `import()` bundles, HMR/Fast Refresh, inspector proxy, web
  SSR + API routes + loaders via expo-server, DOM components) and `bun run export` its `expo export` (EAS Update
  layout, web single/static/server); publish OTA with `bunx eas-cli update --skip-bundler`. Resolution follows Expo
  CLI's resolver chain (`tools/bun-bundler/resolver.ts`) and CSS Expo's transform worker (PostCSS, Sass); only React
  Server Components still need Metro. `bun run start:metro` / `web:metro` / `export:metro` are the Metro escape hatch.
  After changing it run `bun run test:tools`, bundle both platforms, compile with `hermesc`, compare `export` with
  `export:metro` and check web in a browser. Details: `docs/bun-react-native/BUNDLER.md`.
- `.env` files are loaded by the bundler like Expo CLI (`.env.<mode from --dev>`, `tools/bun-bundler/env.ts`); Bun's own
  automatic `.env` loading stays off (`env = false` in `bunfig.toml`, `--no-env-file` in the shim) - it would pick
  `.env.development` for release bundles.
- `bun.lock` must reference the default registry (`""`); `bunfig.toml` pins `https://registry.npmjs.org/`.
