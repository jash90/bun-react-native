# Index: Expo / React Native / Metro / EAS official docs snapshot

Fetched 2026-10-12. Target stack: Expo SDK 57 (expo 57.0.27), React Native 0.86.3, Metro 0.84.x (via @expo/metro), Bun 1.4.3.

| Repo | Commit SHA |
|---|---|
| expo/expo (docs/pages, docs/public) | `fe4a2c8e7875d56283ab314a9b4a0da6b6df159d` |
| react/react-native-website (versioned_docs/version-0.86, blog) | `b477b73b70162ae23b8d3062be2902b0ba660aec` |
| react/metro (docs) | `4fc75654ea66c973688a76a9ffc512ecf9b9e7ff` |
| expo/eas-cli (eas-json schema, build-tools) | `bb98f5beef0e098ee48f01b480df385e21f9a353` |
| expo.dev/changelog (live HTML -> pandoc, no repo) | n/a |

Processing: raw files via `gh api ... contents/<path>?ref=<sha>`. The only changes were removing MDX `import` lines, turning `<Terminal cmd={[...]}/>` into `sh` code blocks, and inlining `<DiffBlock source="/static/diffs/..."/>` as `diff` code blocks taken from the same SHA. All other MDX tags (Collapsible, Tabs, FileTree, multi-package-manager `<Terminal cmd={{npm,bun,...}}>`) were left verbatim. React Native docs are taken from **versioned 0.86** docs.

## Expo (`expo/`)

| File | Title | Source URL | Why it matters for RN on Bun |
|---|---|---|---|
| expo/guides-using-bun.md | Using Bun | https://docs.expo.dev/guides/using-bun/ | Official Bun guide. Node LTS is still needed for `bun create expo` and `prebuild` (they use `npm pack`). Covers how EAS picks Bun from the lockfile, the eas.json `bun` version field, and `trustedDependencies` (e.g. `@sentry/cli`). |
| expo/guides-monorepos.md | Work with monorepos | https://docs.expo.dev/guides/monorepos/ | Metro config supports Bun workspaces out of the box. Also covers `workspace:*`, Bun isolated installs, `bun pm why`, and `experiments.autolinkingModuleResolution`. |
| expo/guides-customizing-metro.md | Metro bundler | https://docs.expo.dev/guides/customizing-metro/ | How to extend `expo/metro-config` (getDefaultConfig, transformer/resolver customization). |
| expo/v57-config-metro.md | metro.config.js (SDK 57) | https://docs.expo.dev/versions/v57.0.0/config/metro/ | Full @expo/metro-config reference for SDK 57, with the bare-project bundling diffs inlined (Expo CLI `export:embed`, entry file). |
| expo/v57-config-package-json.md | package.json (SDK 57) | https://docs.expo.dev/versions/v57.0.0/config/package-json/ | `expo.install` / `expo.autolinking` keys in package.json (searchPaths, legacy flags). |
| expo/more-expo-cli.md | Expo CLI | https://docs.expo.dev/more/expo-cli/ | `expo start/prebuild/run/export:embed` flags and EXPO_* env vars. Under Bun, these are the commands invoked through `bun expo` / `bunx`. |
| expo/more-create-expo.md | create-expo-app | https://docs.expo.dev/more/create-expo/ | `bun create expo` and how the package manager is chosen. |
| expo/workflow-continuous-native-generation.md | Continuous Native Generation (CNG) | https://docs.expo.dev/workflow/continuous-native-generation/ | What prebuild regenerates. Any NODE_BINARY or Gradle edits must therefore live in config plugins. |
| expo/guides-adopting-prebuild.md | Adopt Prebuild | https://docs.expo.dev/guides/adopting-prebuild/ | Migrating to prebuild-managed native dirs. |
| expo/develop-unit-testing.md | Unit testing with Jest | https://docs.expo.dev/develop/unit-testing/ | jest-expo setup, including the **Bun-specific `transformIgnorePatterns`** (`node_modules/(?!(.bun|...))`). |
| expo/guides-environment-variables.md | Environment variables in Expo | https://docs.expo.dev/guides/environment-variables/ | How Expo loads `.env*` and inlines EXPO_PUBLIC_*. This can conflict with Bun's own automatic .env loading. |
| expo/bare-installing-expo-modules.md | Install Expo modules in an existing RN project | https://docs.expo.dev/bare/installing-expo-modules/ | Xcode bundle phase with `"$NODE_BINARY" -e/--print` lines and the Android `expo-cli-android.diff` (cliFile/bundleCommand). Diffs are inlined. These are the exact hooks where Node gets invoked. |
| expo/bare-using-expo-cli.md | Migrate from RN CLI to Expo CLI | https://docs.expo.dev/bare/using-expo-cli/ | Bundling native builds with Expo CLI instead of the RN CLI. |
| expo/modules-autolinking.md | Autolinking | https://docs.expo.dev/modules/autolinking/ | Autolinking resolution (it runs in Node from Podfile/Gradle) and its behavior with isolated or hoisted installs. |
| expo/config-plugins-introduction.md | Introduction to config plugins | https://docs.expo.dev/config-plugins/introduction/ | Basis for a plugin that patches the Podfile, `.xcode.env`, or Gradle for Bun. |
| expo/config-plugins-plugins.md | Create and use config plugins | https://docs.expo.dev/config-plugins/plugins/ | Plugin authoring API (withPlugins, app.plugin.js). |
| expo/config-plugins-mods.md | Mods | https://docs.expo.dev/config-plugins/mods/ | Mod providers (Podfile, gradle.properties, app/build.gradle) for Bun-related native edits. |
| expo/config-plugins-dangerous-mods.md | Using a dangerous mod | https://docs.expo.dev/config-plugins/dangerous-mods/ | Raw file edits, e.g. for `.xcode.env` or files that have no typed mod. |
| expo/config-plugins-development-and-debugging.md | Developing and debugging a plugin | https://docs.expo.dev/config-plugins/development-and-debugging/ | Testing and debugging plugins (EXPO_DEBUG, `expo config --type prebuild`). |
| expo/changelog-sdk-54.md | Expo SDK 54 changelog | https://expo.dev/changelog/sdk-54 | "Improved package manager support and Expo Autolinking revamp": Bun is supported, along with isolated installs and transitive RN module linking. |
| expo/changelog-sdk-55.md | Expo SDK 55 changelog | https://expo.dev/changelog/sdk-55 | Node minimum `^20.19.4`, `@expo/env` now uses Node `parseEnv`, and hermes-compiler override syntax for npm/pnpm/bun. |
| expo/changelog-sdk-56.md | Expo SDK 56 changelog | https://expo.dev/changelog/sdk-56 | Native Node.js watcher replaces Watchman by default, global virtual stores (Bun/pnpm) via the On-demand Filesystem, and the RN 0.85 Node bump. |
| expo/changelog-sdk-57.md | Expo SDK 57 changelog | https://expo.dev/changelog/sdk-57 | SDK 57 = RN 0.86 (no Bun-specific section). Gives the baseline for the target versions. |

## EAS (`eas/`)

| File | Title | Source URL | Why it matters for RN on Bun |
|---|---|---|---|
| eas/build-reference-infrastructure.md | Build server infrastructure | https://docs.expo.dev/build-reference/infrastructure/ | Bun/Node versions per EAS image (e.g. sdk-57 image: Bun 1.3.14, sdk-58: Bun 1.4.2). Shows whether the local 1.4.3 matches. |
| eas/eas-json-reference.md | Configuration with eas.json | https://docs.expo.dev/eas/json/ | Page shell. Its property tables are rendered from the 3 schema files below. |
| eas/eas-json-build-common-schema.js.md | eas.json build common properties (docs data) | https://docs.expo.dev/eas/json/#eas-build | Defines the `bun` field ("Version of Bun used for build"), `node`, `env`, and `image`. |
| eas/eas-json-build-android-schema.js.md | eas.json build Android properties (docs data) | https://docs.expo.dev/eas/json/#android-specific-options | Android image and Gradle command options. |
| eas/eas-json-build-ios-schema.js.md | eas.json build iOS properties (docs data) | https://docs.expo.dev/eas/json/#ios-specific-options | iOS image and CocoaPods options. |
| eas/eas-json-schema.json.md | eas.json JSON Schema (eas-cli) | https://github.com/expo/eas-cli/blob/main/packages/eas-json/schema/eas.schema.json | Machine-readable schema, including `bun`, for validation. |
| eas/eas-build-tools-packageManager.ts.md | build-tools packageManager.ts (source) | https://github.com/expo/eas-cli/blob/main/packages/build-tools/src/utils/packageManager.ts | How EAS detects Bun and which commands it runs (`bun install [--production]`, `bun x`, `bun add`). |
| eas/build-eas-json.md | Configure EAS Build with eas.json | https://docs.expo.dev/build/eas-json/ | Build profiles, plus where `bun`/`node` versions are set. |
| eas/build-reference-npm-hooks.md | Build lifecycle hooks | https://docs.expo.dev/build-reference/npm-hooks/ | `eas-build-pre-install` / `post-install` / `on-success` scripts, run with the detected package manager. |
| eas/build-reference-caching.md | Cache dependencies | https://docs.expo.dev/build-reference/caching/ | What EAS caches (node_modules, package manager caches, `cache.paths`). |
| eas/build-reference-build-configuration.md | Build configuration process | https://docs.expo.dev/build-reference/build-configuration/ | The order of EAS build steps (install, prebuild, and so on). |
| eas/build-reference-build-with-monorepos.md | Set up EAS Build with a monorepo | https://docs.expo.dev/build-reference/build-with-monorepos/ | Monorepo specifics on EAS. |
| eas/build-reference-local-builds.md | Run EAS Build locally | https://docs.expo.dev/build-reference/local-builds/ | `eas build --local` uses the local Node/Bun. |
| eas/build-setup.md | Create your first build | https://docs.expo.dev/build/setup/ | Baseline EAS setup (has bun install tabs). |
| eas/eas-environment-variables.md | Environment variables in EAS | https://docs.expo.dev/eas/environment-variables/ | EAS env model (stands in for the requested "build-reference/variables" page). |
| eas/eas-environment-variables-usage.md | Using environment variables in EAS | https://docs.expo.dev/eas/environment-variables/usage/ | Env vars in builds and updates, built-in EAS_BUILD_* vars, and .env interplay. |

## React Native 0.86 (`react-native/`)

| File | Title | Source URL | Why it matters for RN on Bun |
|---|---|---|---|
| react-native/0.86-set-up-your-environment.md | Set Up Your Environment | https://reactnative.dev/docs/0.86/set-up-your-environment | Environment setup wrapper (the content is in the partials below). |
| react-native/0.86-_getting-started-macos-ios.md | Set up env, macOS + iOS (partial) | https://reactnative.dev/docs/0.86/set-up-your-environment?os=macos&platform=ios | Node requirement and the **`.xcode.env` / `NODE_BINARY`** mechanism. This is the hook for pointing Xcode at Bun. |
| react-native/0.86-_getting-started-macos-android.md | Set up env, macOS + Android (partial) | https://reactnative.dev/docs/0.86/set-up-your-environment?os=macos&platform=android | Node/JDK/Android SDK prerequisites. |
| react-native/0.86-getting-started.md | Get Started with React Native | https://reactnative.dev/docs/0.86/getting-started | Framework (Expo) vs. no-framework guidance. |
| react-native/0.86-integration-with-existing-apps.md | Integration with Existing Apps | https://reactnative.dev/docs/0.86/integration-with-existing-apps | Wrapper for the iOS partial. |
| react-native/0.86-_integration-with-existing-apps-ios.md | Integration with existing apps, iOS (partial) | https://reactnative.dev/docs/0.86/integration-with-existing-apps | Bundle script phase and `.xcode.env` usage in a hand-written Xcode project. |
| react-native/0.86-react-native-gradle-plugin.md | React Native Gradle Plugin | https://reactnative.dev/docs/0.86/react-native-gradle-plugin | All `react {}` options, including **`nodeExecutableAndArgs`** (Android equivalent of NODE_BINARY), `cliFile`, and `bundleCommand`. |
| react-native/0.86-metro.md | Metro | https://reactnative.dev/docs/0.86/metro | RN's Metro config defaults (`@react-native/metro-config`). |
| react-native/0.86-testing-overview.md | Testing | https://reactnative.dev/docs/0.86/testing-overview | Jest preset and testing guidance. |
| react-native/0.86-javascript-environment.md | JavaScript Environment | https://reactnative.dev/docs/0.86/javascript-environment | Hermes runtime and syntax transforms. The app runtime is Hermes, not Bun. |
| react-native/blog-0.84.md | RN 0.84 release | https://reactnative.dev/blog/2026/02/11/react-native-0.84 | "Node.js 22 Minimum" (v22.11+). |
| react-native/blog-0.85.md | RN 0.85 release | https://reactnative.dev/blog/2026/04/07/react-native-0.85 | Jest preset moved to a new package. Drops EOL Node (<20.19.4; lists v20/v22/v24+ as supported, which conflicts with the 0.84 post). |
| react-native/blog-0.86.md | RN 0.86 release | https://reactnative.dev/blog/2026/06/11/react-native-0.86 | Target RN version: no breaking changes, Metro `^0.84.2`. |
| react-native/blog-0.87.md | RN 0.87 release | https://reactnative.dev/blog/2026/08/11/react-native-0.87 | Next version: Node >= 22.13.0, Metro 0.87 with TS/ESM config files, and SwiftPM. |

## Metro (`metro/`)

| File | Title | Source URL | Why it matters for RN on Bun |
|---|---|---|---|
| metro/Configuration.md | Configuring Metro | https://metrobundler.dev/docs/configuration | Full config reference: `transformer.unstable_workerThreads`, `watchFolders`, `resolver.nodeModulesPaths`, `unstable_enableSymlinks`, and `unstable_enablePackageExports`. These are the knobs that matter for Bun's linker and its worker model. |
| metro/GettingStarted.md | Getting Started | https://metrobundler.dev/docs/getting-started | Metro API and CLI basics. |
| metro/PackageExports.md | Package Exports Support | https://metrobundler.dev/docs/package-exports | Resolution of the `exports` field and conditions. |
| metro/Resolution.md | Module Resolution | https://metrobundler.dev/docs/resolution | Resolution algorithm, symlinks, and nodeModulesPaths. Relevant to Bun isolated installs (`node_modules/.bun`). |
| metro/Caching.md | Caching | https://metrobundler.dev/docs/caching | Cache stores and resetting the cache. |
| metro/CLI.md | Metro CLI Options | https://metrobundler.dev/docs/cli | CLI flags. |
| metro/Troubleshooting.md | Troubleshooting | https://metrobundler.dev/docs/troubleshooting | Watcher/cache troubleshooting (short page). |

## Notes / not found

- No standalone `build-reference/variables` page exists at this SHA. It was replaced by `eas/environment-variables/*`, which is included.
- No `workflow/prebuild` page exists. `workflow/continuous-native-generation` and `guides/adopting-prebuild` cover prebuild.
- Expo changelog posts are not in a GitHub repo. They were fetched live from expo.dev, converted with pandoc, and saved as the full article body.
- Metro has no versioned docs. The `react/metro` docs at main are for Metro **0.87.1** (packages/metro/package.json at that SHA), not 0.84.x. Some options may postdate 0.84, so check the 0.84 release notes or source before relying on an `unstable_*` flag.
