---
source: https://expo.dev/changelog/sdk-56 (expo.dev changelog page; not in a GitHub repo, fetched as HTML and converted with pandoc)
fetched: 2026-10-12
repo_sha: n/a (live page on expo.dev, fetched 2026-10-12)
---

# Expo SDK 56

MAY 21, 2026

![Alan Hughes](https://cdn.sanity.io/images/9r24npb8/production/fbc6f8287ef11f9f25db8039fee4ea8445dd7fe2-460x460.jpg?auto=format&fit=max&q=75&w=24)Alan Hughes

![Brent Vatne](https://cdn.sanity.io/images/9r24npb8/production/6aa3e387c3c72e9774c61a8398bbc2f9c427270a-400x400.webp?auto=format&fit=max&q=75&w=24)Brent Vatne

Share



Contents

Share post

[Expo UI is now ready for production](#expo-ui-is-now-ready-for-production)[Universal components](#universal-components)[Stable native APIs](#stable-native-apis)[Drop-in replacements for community components](#drop-in-replacements-for-community-components)[Faster native builds](#faster-native-builds)[Precompiled Expo packages on iOS](#precompiled-expo-packages-on-ios)[Precompiled headers for Android codegen (experimental)](#precompiled-headers-for-android-codegen-experimental)[Expo Modules: easier to write, faster to run](#expo-modules-easier-to-write-faster-to-run)[Inline modules](#inline-modules)[Type generation tools](#type-generation-tools)[Revamped create-expo-module](#revamped-create-expo-module)[Runtime performance improvements in expo-modules-core](#runtime-performance-improvements-in-expo-modules-core)[React Native 0.85 and React 19.2](#react-native-085-and-react-192)[Hermes bytecode diffing is now enabled by default](#hermes-bytecode-diffing-is-now-enabled-by-default)[More capable expo-file-system](#more-capable-expo-file-system)[Status bar and navigation bar APIs are now consistent](#status-bar-and-navigation-bar-apis-are-now-consistent)[New Calendar, Contacts, and MediaLibrary APIs are now stable](#new-calendar-contacts-and-medialibrary-apis-are-now-stable)[Widgets for iOS promoted to stable](#widgets-for-ios-promoted-to-stable)[AI-friendly project scaffolding](#ai-friendly-project-scaffolding)[Convex integration](#convex-integration)[Expo CLI](#expo-cli)[Type-safe config plugins](#type-safe-config-plugins)[Expo Router](#expo-router)[New features](#new-features)[Brownfield: more flexibility for embedded Expo apps](#brownfield-more-flexibility-for-embedded-expo-apps)[Expo Application Services (EAS)](#expo-application-services-eas)[Build time statistics for xcodebuild and Gradle](#build-time-statistics-for-xcodebuild-and-gradle)[Prebuilt artifacts for major community libraries](#prebuilt-artifacts-for-major-community-libraries)[Coming soon: EAS Observe](#coming-soon-eas-observe)[Other notable changes](#other-notable-changes)[Deprecations](#deprecations)[Notable breaking changes](#notable-breaking-changes)[Tool version bumps](#tool-version-bumps)[Expo Go](#expo-go)[Known regressions](#known-regressions)[Upgrading your app](#upgrading-your-app)[Thanks to everyone who contributed to the release!](#thanks-to-everyone-who-contributed-to-the-release)





![Expo SDK 56 is released. SDK 56 includes React Native 0.85](https://cdn.sanity.io/images/9r24npb8/production/50c29eb359f130b13fd65e45f4edeb33b86cef32-1800x1012.png?auto=format&fit=max&q=75&w=1200)

Today we're announcing the release of Expo SDK 56. SDK 56 includes [React Native 0.85](https://reactnative.dev/blog/2026/04/07/react-native-0.85) and [React 19.2](https://react.dev/blog/2025/10/01/react-19-2). Thank you to everyone who helped with beta testing.

> **Update on August 27th**: SDK 56 has a known Hermes V1 memory regression that can affect apps using `react-native-worklets` and `react-native-reanimated`. This is resolved in SDK 57, which is equivalent to a minor release and is designed to be an easy upgrade. We recommend upgrading to SDK 57, as per the ["Known Regressions" notes](#known-regressions).

## **Expo UI is now ready for production**

As of SDK 56, the Jetpack Compose (Android) and SwiftUI (iOS) APIs in Expo UI are stable. We've added Expo UI to the default [`create-expo-app`](https://docs.expo.dev/more/create-expo/) template, so new Expo apps can use a rich set of native UI primitives right out of the box, and Expo UI is now available in Expo Go.

This milestone release builds on three SDK cycles of iteration across SDK 53, 54, and 55. Thank you to everyone on the Expo team and in the community who helped test, audit, and refine the APIs from the original SwiftUI prototype to the Jetpack Compose implementation.

SDK 56 focuses on three core pieces of Expo UI: a new universal components API for shared interfaces, stable native APIs, and drop-in replacements for popular React Native community libraries.

### Universal components

![Universal field group settings UI](https://cdn.sanity.io/images/9r24npb8/production/ee26451583a47ae1b6d0e468234944e2915cba58-1282x690.png?auto=format&fit=max&q=75&w=800)

Expo UI now includes universal components that work across Android, iOS, and web. Unlike the Android and iOS APIs, the web APIs are still experimental and likely to change.

The universal components are backed by [`@expo/ui/jetpack-compose`](https://docs.expo.dev/versions/v56.0.0/sdk/ui/jetpack-compose/) on Android, [`@expo/ui/swift-ui`](https://docs.expo.dev/versions/v56.0.0/sdk/ui/swift-ui/) on iOS, and `react-dom` or `react-native-web` on web. You can now build more cross-platform UI with Expo UI without splitting files into `.android.tsx` and `.ios.tsx`.

Universal components include layout primitives, text, inputs, controls, and sheets such as `Host`, `Row`, `Column`, `ScrollView`, `Text`, `TextInput`, `Button`, `Switch`, `Slider`, `Checkbox`, and `BottomSheet`. [Learn more](https://docs.expo.dev/versions/v56.0.0/sdk/ui/universal/).

### Stable native APIs

Expo UI's SwiftUI and Jetpack Compose APIs are now stable after several rounds of breaking changes. These changes align Expo UI more closely with the underlying frameworks, so developers and coding agents can lean on native platform documentation and examples directly when writing Expo UI code.

- **Extend Expo UI with custom views and modifiers**: you can now extend Expo UI with your own SwiftUI and Jetpack Compose views and modifiers. Expo UI manages layout synchronization, props, and events for you. See the guides for examples: [SwiftUI guide](https://docs.expo.dev/guides/expo-ui-swift-ui/extending/) and [Compose guide](https://docs.expo.dev/guides/expo-ui-jetpack-compose/extending/).
- **Material 3 Dynamic Colors and the Material Symbols catalog**: the new [`useMaterialColors`](https://docs.expo.dev/versions/v56.0.0/sdk/ui/jetpack-compose/colors/) hook hands you Material 3 Dynamic Colors that follow the system theme, and the [`Icon`](https://docs.expo.dev/versions/v56.0.0/sdk/ui/jetpack-compose/icon/) component pairs with [`@expo/material-symbols`](https://www.npmjs.com/package/@expo/material-symbols) to bring the full Material Symbols catalog within import reach.
- **`react-native-worklets` integration and native state**: Expo UI now integrates with `react-native-worklets` and native state primitives from the underlying UI frameworks: [`ObservableObject`](https://developer.apple.com/documentation/combine/observableobject) on SwiftUI and [`MutableState`](https://developer.android.com/reference/kotlin/androidx/compose/runtime/MutableState) on Jetpack Compose. The new `useNativeState` hook lets JavaScript control that native state directly, which is useful for native state-driven animations and form controls. Learn more about `useNativeState` for [SwiftUI](https://docs.expo.dev/versions/v56.0.0/sdk/ui/swift-ui/usenativestate/) and [Jetpack Compose](https://docs.expo.dev/versions/v56.0.0/sdk/ui/jetpack-compose/usenativestate/).
- **Synchronous worklet callbacks**: a new `WorkletCallback` shared object allows synchronous UI worklet callbacks to be passed as props to Expo UI views on both platforms. `TextField` on iOS and Compose can now use native state for `value`, and `onValueChange` accepts `WorkletCallback`, enabling synchronous, flicker-free controlled text inputs.
- **Components, modifiers, and API changes**: SDK 56 lands the bulk of the stabilization work since SDK 55. See the [`@expo/ui` CHANGELOG](https://github.com/expo/expo/blob/main/packages/expo-ui/CHANGELOG.md) for the full list.

### Drop-in replacements for community components

Expo UI is focused on native primitives, and some of those primitives overlap with popular community libraries. To make migration easier and reduce library fragmentation, SDK 56 introduces drop-in replacements for several common community components.

For example, you can migrate from:

to:

Drop-in replacements are available for `@gorhom/bottom-sheet`, `@react-native-community/datetimepicker`, `@react-native-masked-view/masked-view`, `@react-native-menu/menu`, `react-native-pager-view`, `@react-native-picker/picker`, `@react-native-segmented-control/segmented-control`, and `@react-native-community/slider` APIs. Most migrations only require changing the import, though some props may be unsupported or differ because Expo UI is backed by SwiftUI and Jetpack Compose rather than UIKit and Android Views. [Learn more](https://docs.expo.dev/versions/v56.0.0/sdk/ui/drop-in-replacements/).

## **Faster native builds**

### Precompiled Expo packages on iOS

SDK 56 ships [prebuilt XCFrameworks](https://docs.expo.dev/guides/prebuilt-expo-modules/) for our most complex Expo modules on iOS, to speed up your iOS builds. In our measurements, this cuts median clean iOS build times by around 1 minute (~16%) — both locally and on EAS Build. This is enabled by default both locally and on EAS Build — no configuration required. To opt out, set the `EXPO_USE_PRECOMPILED_MODULES` environment variable to `0` (for local builds), and also as an [EAS environment variable](https://docs.expo.dev/eas/environment-variables/manage/) (for EAS Build).

### Precompiled headers for Android codegen (experimental)

A new opt-in `android.usePrecompiledHeaders` option in [`expo-build-properties`](https://docs.expo.dev/versions/v56.0.0/sdk/build-properties/) applies CMake precompiled headers to the C++ codegen output for every autolinked native module, dramatically cutting CMake compile times on Android. In our benchmarks, the `:app:buildCMakeDebug` task dropped from 17m 10s to 6m 06s — a 2.81x speedup. In a default new project, builds are about 1.3x faster. Results will vary by project, but the larger your autolinked module graph, the bigger the win.

![Android codegen compilation cut by nearly two thirds: :app:buildCMakeDebug went from 17m 10.724s to 6m 06.692s, a 2.81x speedup and 11m 04s saved](https://cdn.sanity.io/images/9r24npb8/production/1e273286c8c514e9d1a57cd5ab7402634c7b30c5-1800x1012.png?auto=format&fit=max&q=75&w=800)

Enable it in **app.json**:

This feature is experimental in SDK 56 while we gather feedback, and we're working on upstreaming it to React Native so every app benefits from faster Android builds. [Learn more in the PR](https://github.com/expo/expo/pull/45922).

## **Expo Modules: easier to write, faster to run**

### Inline modules

Starting with SDK 56, you can now define Expo modules directly within your project structure, alongside your JavaScript and TypeScript code. We call these inline modules, and they make experimenting with native code easier than ever.

After setting up your app to use inline modules, you can open Kotlin and Swift files and write your Expo modules with no additional setup. During prebuild, the iOS Xcode project is updated and the necessary options are set in the Android project, which lets us add inline modules to the build and autolink them automatically.

With the newly released type generation tools, which offer a few CLI commands tailored towards inline modules, you will have an even smoother experience. You can just create a Swift inline module and a CLI watcher will automatically generate a TypeScript interface for it right beside the Swift file. The TypeScript interface is separated into a generated and stable part, so that you have control over your stable TS interface and leave the generated part to be regenerated on any changes. If you want more control you can always generate these files manually.

You can develop inline modules from Android Studio, Xcode, or any other IDE as they are part of your project structure.

Check out the inline modules [reference](https://docs.expo.dev/modules/inline-modules-reference/) and the [tutorial](https://docs.expo.dev/modules/inline-modules-tutorial/) for more information!

### Type generation tools

In SDK 56 we introduce a powerful new tool for developing Expo Modules. The new `expo-type-information` package exports functions that parse and retrieve type information from a Swift Expo module and ones that generate TypeScript interface from the retrieved information.

It also includes a CLI with the following key commands:

- `module-interface`: takes a Swift Expo module (accepting multiple file paths or a path to the module root) and generates multiple TypeScript files based on our standard interface scheme:
  - **\[ModuleName\]Types.ts**: contains all type declarations.
  - **\[ModuleName\]Module.ts**: contains the module class.
  - **\[ModuleName\]View.tsx**: exports the default view component(s) with typed props.
  - **index.ts**: re-exports the module alongside every defined type and view.
- `inline-modules-interface`: generates a pair of TypeScript files (**generated**, **stable**) for each Swift inline module in a project.
- `short-module-interface`: works similarly to `inline-modules-interface`, but targets a specific Swift module instead of all inline modules in the project.

All of these commands can be run in a watch mode to automatically regenerate the TypeScript interfaces.

[Learn more in the `expo-type-information` reference](https://docs.expo.dev/modules/type-generation-reference/) and [tutorial](https://docs.expo.dev/modules/type-generation-tutorial/).

### Revamped `create-expo-module`

In SDK 56, [`create-expo-module`](https://docs.expo.dev/more/create-expo-module/) has been revamped for improved stability and a richer feature-set.

- **New `create-expo-module` skill**: helps agents create Expo modules — [coming soon](https://github.com/expo/skills/pull/49).
- **New `addPlatformSupport` subcommand**: adds support for additional platforms in an existing module — for example, adding Android support to an iOS-only module. The command detects the features currently used in your module and scaffolds the native files for you.
- **Modular template**: when creating a module you can pick which features get scaffolded and which platforms it targets.
- **Non-interactive mode support**: field defaults have been improved and some fields are no longer required; in non-interactive mode, `create-expo-module` logs the defaults that were used.
- **No barrel file by default**: local modules no longer use `index.ts`; pass `--barrel` to opt in.
- **Windows support**: `create-expo-module` now works well on Windows.

### Runtime performance improvements in `expo-modules-core`

**Kotlin compiler plugin** — A new Kotlin compiler plugin replaces reflection with build-time code generation for Expo Modules on Android. [In our benchmarks](https://x.com/lkosmaty/status/2051693879770964433), we're seeing roughly 40% faster cold starts and 33% faster first render, with no app-side changes required. By collecting module metadata at compile time rather than runtime, we eliminate the reflection-based function-type-to-converter mapping that has historically been a major speed bump for Expo Modules on Android. Results will vary by project, but this is only the beginning — this compiler-driven approach lets us optimize function invocation directly, starting with a noticeable speed boost for Record conversion in SDK 56.

![Activity.onCreate is 1.7x faster (55 ms vs 93 ms on SDK 55), and Time to Interactive is 1.5x faster (531 ms vs 797 ms on SDK 55)](https://cdn.sanity.io/images/9r24npb8/production/c65a7a9feff90c80b09300a61d6b528d00ba7db6-1800x1012.png?auto=format&fit=max&q=75&w=800)

**New JSI layer for iOS native modules** — Until now, calling into a native module from JavaScript on iOS meant crossing three language boundaries: Swift, Objective-C++, and C++. In SDK 56 we removed the Objective-C++ middle layer entirely by adopting Swift/C++ interop to talk to JSI directly. Fewer hops means less call overhead, and in our benchmarks we're seeing significant performance improvements across native module calls. The codebase is also significantly easier to work with now that it is Swift all the way down. We'll cover the architecture, benchmarks, and what this enables in an in-depth blog post.

## **React Native 0.85 and React 19.2**

Expo SDK 55 included React Native 0.83, so be sure to refer to the full release notes for [0.84](https://reactnative.dev/blog/2026/02/11/react-native-0.84) and [0.85](https://reactnative.dev/blog/2026/04/07/react-native-0.85) for the complete picture. A few highlights include:

- **Hermes v1 by default**: Hermes v1 is now the default JavaScript engine, bringing faster startup times, improved runtime performance, and reduced memory usage. You can opt out with the [`useHermesV1`](https://docs.expo.dev/versions/v56.0.0/sdk/build-properties/#sharedbuildconfigfields) configuration in [`expo-build-properties`](https://docs.expo.dev/versions/v56.0.0/sdk/build-properties/).
- **New animation backend**: React Native 0.85 introduces a new animation backend designed to better align with the New Architecture, improving consistency and performance of animations across platforms.
- **HTTPS dev server**: the Metro dev server now supports HTTPS via TLS configuration, enabling secure local development environments and compatibility with APIs that require secure origins.
- **Node.js minimum bump**: React Native 0.85 drops support for Node.js versions before v20.19.4.

## **Hermes bytecode diffing is now enabled by default**

In SDK 55 we [introduced opt-in Hermes bytecode diffing](https://expo.dev/changelog/sdk-55#hermes-bytecode-diffing-for-eas-update-and-expo-updates) for `expo-updates` and [EAS Update](https://expo.dev/services#update): instead of downloading a full bundle on every update, the client downloads a binary patch against the previously installed bytecode. In the 24 hours before this post went out, EAS Update served diffed Hermes bundles that were on average **58% smaller** than the full bundle they replaced.

Diffing is on by default in SDK 56. To opt out, set `"enableBsdiffPatchSupport": false` in the `updates` block of **app.json**. [Learn more in the `expo-updates` API reference](https://docs.expo.dev/versions/v56.0.0/sdk/updates/).

We're also working on extending bytecode diffing to patch against the **embedded bundle shipped in your native build**, not just against the previously installed update. This will give the first update after a fresh install the same size savings that subsequent updates already see. We're planning to ship this as an opt-in feature in an SDK 56 patch release in the coming months.

## **More capable `expo-file-system`**

SDK 56 fills several parity gaps in the new [`expo-file-system`](https://docs.expo.dev/versions/v56.0.0/sdk/filesystem/) API that became the default in SDK 54. `File.downloadFileAsync()` now reports progress and supports `AbortSignal`, and copy/move operations accept an `overwrite` option.

The new API also adds task-based upload and download APIs: `file.createUploadTask()` and `File.createDownloadTask()`. These bring back support for long-running transfers from the legacy file-system module, including upload progress, cancellation, and resumable downloads. For simpler uploads, `File.upload()` provides a convenience wrapper when you do not need to manage an upload task directly.

File picking is more capable now too: `File.pickFileAsync()` supports selecting multiple files and multiple MIME types, bringing it closer to [`expo-document-picker`](https://docs.expo.dev/versions/v56.0.0/sdk/document-picker/) feature parity. We also fixed several correctness and reliability issues, including large-file `md5` hashing memory usage, Android SAF copy/move support, and `totalDiskSpace` reporting on iOS.

We've also added experimental file-system event watching with `File.watch()` and `Directory.watch()`, which will let apps subscribe to file and directory changes without polling.

## **Status bar and navigation bar APIs are now consistent**

Both [`expo-status-bar`](https://docs.expo.dev/versions/v56.0.0/sdk/status-bar/) and [`expo-navigation-bar`](https://docs.expo.dev/versions/v56.0.0/sdk/navigation-bar/) now expose a React component with the same prop surface, where multiple instances merge in mount order. To make that possible, we added a new `<NavigationBar>` component:

We also added a config plugin for `expo-status-bar`, and both packages' plugin options now align:

## **New Calendar, Contacts, and MediaLibrary APIs are now stable**

With the release of Expo SDK 56, the next versions of the [`expo-calendar`](https://docs.expo.dev/versions/v56.0.0/sdk/calendar/), [`expo-media-library`](https://docs.expo.dev/versions/v56.0.0/sdk/media-library/), and [`expo-contacts`](https://docs.expo.dev/versions/v56.0.0/sdk/contacts/) libraries are officially promoted to stable.

The updated APIs have been redesigned with an object-oriented approach. Items like media assets or individual contacts are now represented as classes, which unlocks new features and makes them much easier to work with. Key improvements include granular data fetching (instead of loading entire, heavy objects at once, you can now fetch the specific properties you need) and cleaner querying and filtering using the Builder pattern.

For more technical details and usage examples on the new MediaLibrary and Contacts APIs, check out [the blog post](https://expo.dev/blog/the-next-generation-of-expo-apis-medialibrary-and-contacts).

## **Widgets for iOS promoted to stable**

After introducing an alpha version of [Expo Widgets](https://docs.expo.dev/versions/v56.0.0/sdk/widgets/) for iOS in SDK 55, we gathered feedback and made many fixes and improvements, and the library is now stable. In SDK 56, Widgets and Live Activities have full access to the environment and no longer need to be pre-rendered. We also improved timeline management, error handling, the config plugin, and the render timeline.

## **AI-friendly project scaffolding**

- **Agent-ready scaffolding**: new projects include **AGENTS.md**, **CLAUDE.md**, and `.claude/settings.json` with Expo-specific guidance.
- **Official [Expo Skills](https://docs.expo.dev/skills/) for AI agents**: install in Claude Code with `/plugin marketplace add expo/skills` followed by `/plugin install expo`. For Codex, Cursor, or any other agent, run `npx skills add expo/skills`. See the docs for per-tool setup details.

## **Convex integration**

EAS now provisions and links [Convex](https://www.convex.dev/) backends for you. Run `eas integrations:convex:connect` in your project and we'll install `convex`, create (or reuse) a Convex team linked to your EAS account, set up a project with a dev deployment, and write `CONVEX_DEPLOY_KEY` and `EXPO_PUBLIC_CONVEX_URL` to your **.env.local**. We also create `EXPO_PUBLIC_CONVEX_URL` as an EAS environment variable across Production, Preview, and Development so EAS Build picks it up automatically.

## **Expo CLI**

![expo start is 5x faster, Metro crawl 6x faster, dev memory −28 %, cold bundling 20-50%, warm bundling 3-8x faster](https://cdn.sanity.io/images/9r24npb8/production/98a77fc2842c0f7e9fa675355eb7663890afa1b5-3291x2670.png?auto=format&fit=max&q=75&w=800)

SDK 56 ships the first wave of performance improvements across the whole bundling and run pipeline, with more landing in future releases.

- **Faster CLI**: Various performance metrics of the Expo CLI have been improved in SDK 56
- **On-demand Filesystem**: eliminates `watchFolders` as a load-bearing configuration option. Enabled by default; disable it by adding `experiment.onDemandFilesystem: false` to your **app.json**. [Learn more in the PR](https://github.com/expo/expo/pull/45391).
- **Native Node.js watcher by default**: rather than Watchman, we now use a native Node.js watcher and crawler by default. You can switch back to Watchman with `resolver.useWatchman` in a Metro config, but it's no longer recommended.
- **TypeScript 6 support and TypeScript 7 readiness**: we replaced our [TypeScript](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) resolution to support TS 6 and prepare for [TS 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/). This resolves some monorepo bugs with `tsconfig.json`'s `paths` config ([\#44791](https://github.com/expo/expo/pull/44791), [\#45227](https://github.com/expo/expo/pull/45227)).
- **`import.meta` support**: now enabled automatically ([\#44239](https://github.com/expo/expo/pull/44239)).
- **Hermes v1 transforms**: fewer bundler transforms are enabled for Hermes, which reduces bundling times overall ([\#45263](https://github.com/expo/expo/pull/45263), [\#45345](https://github.com/expo/expo/pull/45345)).

With the On-demand Filesystem, you can also now try Expo with [global virtual stores](https://pnpm.io/global-virtual-store) (such as in Bun and pnpm), which deduplicates installed Node modules across projects (saving ~300 MB per duplicate Expo install) and speeds up installs for agents working across multiple Git worktrees.

### Type-safe config plugins

Every Expo package that ships a config plugin now exports it with full TypeScript types. Import the plugin from `expo-<name>/plugin` into your **app.config.ts** to get autocomplete, JSDoc, and deprecation hints for plugin options without leaving your editor.

![JSDoc for an Expo config plugin's options inside app.config.ts](https://cdn.sanity.io/images/9r24npb8/production/3d7dd77b74a53cc8fe3ab68dfad900a67615a422-1278x922.png?auto=format&fit=max&q=75&w=800)

Additionally, config plugins are now loaded with the same module loader that configs themselves use. This means you'll now also be able to reference local `.ts` files in your **plugins** list, or write config plugins with `.mjs` or `.cjs` extensions.

## **Expo Router**

Expo goes way back with React Navigation: [@brentvatne](https://github.com/brentvatne) led the project for the 1.0 and 2.0 releases, working together with [@ericvicenti](https://github.com/ericvicenti) and [@satya164](https://github.com/satya164), and we helped to grow it from an idea, to a conceptual merging of React Native's old `NavigationExperimental` and [ex-navigation](https://github.com/expo/ex-navigation), to the standard navigation library in the React Native ecosystem (now one of the standards, alongside Expo Router).

Today, React Navigation is in [Satya's](https://github.com/satya164) great hands, and our focus in the navigation space has shifted towards Expo Router. We spoke with Satya and agreed that the best path forward for both projects was for Expo Router to fork the parts of React Navigation that it builds around. You can, of course, continue to use React Navigation in your Expo projects if you find that you prefer it (try it out: `npx create-expo-app@latest --template react-navigation/template`). Both libraries build upon [react-native-screens](https://github.com/software-mansion/react-native-screens) and have different takes on the developer experience, with Expo Router preferring file system-based routing. We expect that each library will continue to push the other forward in the future, and that the best ideas will continue to flow between them.

Now that `expo-router` no longer depends on `react-navigation`, most code imported directly from `@react-navigation/*` packages will no longer work out of the box alongside `expo-router`.

Run the codemod to handle most of the migration automatically (replace `[your-source-directory]` with your source folder, e.g. `src` or `app`):

See the [migration guide](https://docs.expo.dev/router/migrate/sdk-55-to-56/) for full details, including manual migration steps.

### New features

- On Android, we've added experimental support for a toolbar. You can try it using the same API available on iOS: [`Stack.Toolbar`](https://docs.expo.dev/router/advanced/stack-toolbar/).
- In collaboration with [`react-native-screens`](https://github.com/software-mansion/react-native-screens), we've also introduced experimental support for [a new version of the native stack](https://github.com/software-mansion/react-native-screens/releases/tag/4.25.0-beta.1) (Stack v5), including initial support for Material-style headers and predictive back gesture.
- For Expo on the Web, we now support streaming SSR when using the `unstable_useServerRendering` flag. As part of this change, we've also introduced a new [`generateMetadata`](https://docs.expo.dev/router/web/server-rendering/#metadata) function for retrieving and setting metadata on initial page load. The existing `<Head>` component can still be used for updating metadata after hydration. Let us know how it works for you!
- We've also added two new helpers for data loaders: [`createStaticLoader`](https://docs.expo.dev/versions/v56.0.0/sdk/server/#createstaticloaderfn) and [`createServerLoader`](https://docs.expo.dev/versions/v56.0.0/sdk/server/#createserverloaderfn), which narrow the callback signature for each rendering mode. `createStaticLoader` receives only route params (no `request`), while `createServerLoader` always passes a `request` and throws an actionable error if mistakenly used during static generation.
- We've also added the ability to [customize the default `<Suspense>` fallbacks in a `_layout` route](https://docs.expo.dev/router/error-handling/#loading-states-with-suspense-fallback), giving you more control over loading states across your app. Following the same convention as `ErrorBoundary`, you can export a `SuspenseFallback` that receives route parameters, making it easy to show loading UI:

## **Brownfield: more flexibility for embedded Expo apps**

SDK 56 builds on the brownfield foundation we shipped in SDK 55, with three meaningful additions for teams embedding Expo into existing native apps.

**Multiple isolated apps in one host.** A new experimental option lets one host app contain multiple inner [`expo-brownfield`](https://docs.expo.dev/versions/v56.0.0/sdk/brownfield/) apps. Opt in by setting `multipleFrameworks: true` on the iOS plugin config, and each framework gets a unique Swift module name plus an auto-applied ObjC symbol prefix across its entire pod dependency graph, so two brownfield apps can ship side by side without colliding.

**Custom Turbo Modules from the host app.** Host apps can now register their own turbo module classes with the inner Expo app's React Native runtime, by passing a `turboModuleClasses` dictionary into `ReactNativeHostManager.initialize`. This makes it much easier to expose host-app capabilities (auth, app-specific SDKs, native UI controllers) to JavaScript without modifying the inner app's bundle.

**iOS prebuilds by default.** `expo-brownfield` now uses prebuilt React Native frameworks on iOS out of the box, which substantially cuts brownfield build times. If you need to opt back into building React Native from source, use the new `buildReactNativeFromSource` plugin option.

## **Expo Application Services (EAS)**

### Build time statistics for xcodebuild and Gradle

EAS Build now surfaces per-step timing for `xcodebuild` and Gradle, so you can see exactly where your native build time is spent and decide what to optimize first.

![EAS Build dashboard showing per-module Xcode compile metrics on the left and a Gradle task execution profile on the right](https://cdn.sanity.io/images/9r24npb8/production/9618054905521c884fd40331eede9e97779091c0-1800x1049.png?auto=format&fit=max&q=75&w=800)

### Prebuilt artifacts for major community libraries

Building on the [precompiled Expo packages](#faster-native-builds) work in SDK 56, EAS Build now precompiles some of the most commonly used community libraries in the React Native ecosystem too — like `react-native-reanimated` and `react-native-screens`. In our measurements, this cuts median iOS clean build times on EAS Build by another ~1 minute (~20%) on top of the Expo-modules precompile, with bigger savings for apps that use more of these libraries.

### Coming soon: EAS Observe

We're working on [EAS Observe](https://expo.dev/solutions/expo-observe), a production performance monitoring service for Expo apps that tracks real-world metrics on your users' devices. Compare metrics across releases to catch regressions early, then investigate detailed session data (on your own, or hand it off to an LLM) when something looks off. [Kadi Kraman](https://github.com/kadikraman) shared a deeper preview at [App.js Conf](https://appjs.co/) — keep an eye out for the recording.

## **Other notable changes**

- [**`expo-audio`**](https://docs.expo.dev/versions/v56.0.0/sdk/audio/): new `useAudioStream` hook for real-time microphone buffer access ([\#44902](https://github.com/expo/expo/pull/44902)). Live-stream improvements: `isLiveStream` lock-screen option on iOS ([\#43088](https://github.com/expo/expo/pull/43088)), `playsInSilentMode` on Android ([\#43117](https://github.com/expo/expo/pull/43117)), and `isLive` / `currentOffsetFromLive` / `error` fields on `AudioStatus` ([\#44441](https://github.com/expo/expo/pull/44441)).
- [**`expo-haptics`**](https://docs.expo.dev/versions/v56.0.0/sdk/haptics/): web haptics on Safari ([\#44261](https://github.com/expo/expo/pull/44261)).
- [**`expo-asset`**](https://docs.expo.dev/versions/v56.0.0/sdk/asset/): GLB model assets for 3D / AR work ([\#42495](https://github.com/expo/expo/pull/42495)).
- [**`expo-sqlite`**](https://docs.expo.dev/versions/v56.0.0/sdk/sqlite/): native `ArrayBuffer` for blob columns ([Android \#42640](https://github.com/expo/expo/pull/42640) / [iOS \#42642](https://github.com/expo/expo/pull/42642)), statement bind params ([\#42639](https://github.com/expo/expo/pull/42639)), and session changesets ([\#42638](https://github.com/expo/expo/pull/42638)) — replacing the legacy `JavaScriptArrayBuffer`.
- [**`expo-dev-launcher`**](https://docs.expo.dev/versions/v56.0.0/sdk/dev-client/): error-screen "Copy" button ([\#44723](https://github.com/expo/expo/pull/44723)), NDS service discovery on Android, Android edge-to-edge ([\#44529](https://github.com/expo/expo/pull/44529)), and plugin options for `defaultLaunchURL` ([\#44419](https://github.com/expo/expo/pull/44419)), `skipOnboarding`, and `showMenuAtLaunch` ([\#45167](https://github.com/expo/expo/pull/45167)).
- **`expo-doctor`**: a new check warns when `expo-router` and `react-navigation` are both installed — a likely unintended pairing now that `expo-router` no longer sits on top of `react-navigation` ([\#45323](https://github.com/expo/expo/pull/45323)).
- [**`expo/fetch`**](https://docs.expo.dev/versions/v56.0.0/sdk/expo/#expofetch-api): brotli, gzip, and zstd response decompression on Android ([\#45458](https://github.com/expo/expo/pull/45458)), and `AbortSignal.timeout` / `AbortSignal.any` support for WinterTC-compatible fetch behavior ([\#45441](https://github.com/expo/expo/pull/45441)).

## **Deprecations**

- **`@expo/vector-icons` will be replaced by `@react-native-vector-icons/*`**: the new [scoped packages](https://github.com/oblador/react-native-vector-icons) (one per icon set, e.g. `@react-native-vector-icons/material-design-icons`) are distinct from the older umbrella `react-native-vector-icons` package that `@expo/vector-icons` originally replaced. `@expo/vector-icons` was created for Expo Go compatibility; recent upstream work has made that wrapper unnecessary, so consolidating onto `@react-native-vector-icons/*` reduces duplication and gives you the latest icons and fixes directly. Migrate today by running `npx @react-native-vector-icons/codemod` — [Learn more about the codemod](https://github.com/oblador/react-native-vector-icons/blob/master/MIGRATION.md).
- **Original `expo-calendar`, `expo-contacts`, and `expo-media-library` APIs**: superseded by the [redesigned versions now promoted to stable](#new-calendar-contacts-and-medialibrary-apis-are-now-stable) — the original APIs are deprecated.

## **Notable breaking changes**

- **`expo/fetch` as `globalThis.fetch`**: `expo/fetch` is now installed as the default implementation of `globalThis.fetch`, providing a WinterTC-compliant API and improved performance. Manual imports are no longer required. To opt out, set `EXPO_PUBLIC_USE_RN_FETCH=1` in your **.env** file. [Learn more](https://docs.expo.dev/versions/v56.0.0/sdk/expo/#expofetch-api).
- **Async `copy()` and `move()` in `expo-file-system`**: these methods on `File` and `Directory` are now asynchronous and return a Promise. Use `copySync()` and `moveSync()` for synchronous behavior.
- **`@expo/dom-webview` as the default WebView for DOM components**: you no longer need the `react-native-webview` dependency to use DOM components. You can still opt out and continue using `react-native-webview` if needed. [Learn more in the usage guide](https://docs.expo.dev/guides/dom-components/#usage).
- Related to the planned deprecation of `@expo/vector-icons` (see the previous paragraph), the `expo` package no longer depends on `@expo/vector-icons`. If you wish to continue using `@expo/vector-icons`, you need to explicitly add it to your project's dependencies in `package.json`.

## **Tool version bumps**

- **Minimum Xcode bumped to 26.4.**
- **Minimum iOS / tvOS bumped to 16.4, macOS to 13.4.** Up from iOS 15.1 (last bumped August 2024). Drops support for iPhone 7/7+, iPhone 6s/6s+, iPhone SE (1st gen), iPad mini 4, and iPad Air 2.
- [**TypeScript bumped to 6.0.3**](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) — included in new project templates and pulled in for existing projects via `npx expo install --fix`. To opt out, add `typescript` to the [`expo.install.exclude`](https://docs.expo.dev/versions/v56.0.0/config/package-json/#installexclude) field in your **package.json**.

## **Expo Go**

> **Reminder**: The Expo Go app is our tool for getting started quickly, it's an educational tool to help you learn to build on mobile. If you are past that stage and want to build and ship an app, we encourage you to migrate your project to using a [development build](https://docs.expo.dev/develop/development-builds/expo-go-to-dev-build/).

**Expo Go for SDK 56 is not available on the Apple App Store or Google Play Store.** We do not have a timeline for when they will be, and we'll update this post when we have more news to share.

- You can install Expo Go for SDK 56 from Expo CLI directly on Android devices.
- For iOS, you can use the [TestFlight External Beta](https://testflight.apple.com/join/GZJxxfUU) or the `eas go` command to create an Expo Go build for SDK 56 and upload it to your own TestFlight team.

## **Known regressions**

- **Increased memory usage with Hermes v1 and [`react-native-worklets`](https://docs.swmansion.com/react-native-worklets/)**: importing `react-native-worklets` or `react-native-reanimated` can increase your app's memory usage drastically, due to a known bug in Hermes v1 that shipped with React Native 0.85 ([expo/expo#46519](https://github.com/expo/expo/issues/46519)).
- [Worklets bundle mode](https://docs.swmansion.com/react-native-worklets/docs/bundleMode/) may work around the above issue, but it is unsupported and experimental, and may not work as expected in many cases. We currently do not recommend it for production use until it's officially supported.
- **Increased startup time in development**: a Hermes V1 regression can unintentionally increase app startup time during development ([expo/expo#48298](https://github.com/expo/expo/issues/48298)). This does not affect production apps.

[SDK 57](./sdk-57) resolves the regression that caused increased memory usage, and we recommend to upgrade to SDK 57 for all apps that currently use Hermes v1 and SDK 55 or 56. The upgrade from SDK 56 is equivalent to a minor release and designed to be an easy upgrade.

## **Upgrading your app**

Try using our [upgrade skills](https://github.com/expo/skills/tree/main/plugins/upgrading-expo) ([installation instructions](https://github.com/expo/skills/tree/main?tab=readme-ov-file#claude-code)) with Claude Code, or a similar tool of your choice, to upgrade your app.

Here's how to upgrade your app to Expo SDK 56 from 55:

- **Upgrade all dependencies to match SDK 56**:

- **Check for any possible known issues with Expo Doctor**:

- **Refer to the ["Deprecations"](#deprecations) and ["Notable breaking changes"](#notable-breaking-changes) sections** above for breaking changes that are most likely to impact your app.
- **Make sure to check the [changelog](https://github.com/expo/expo/blob/main/CHANGELOG.md) for all other breaking changes!**
- **Upgrade Xcode if needed**: Xcode 26.4 is required to compile a native iOS project. For EAS Build and Workflows, profiles without any specified `image` will default to Xcode 26.4.
- **iOS deployment target bump**: if you have any Expo modules of your own, update the iOS deployment target to `16.4` in your podspec.

- **If you use [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)**:
  - Delete the **android** and **ios** directories if you generated them for a previous SDK version in your local project directory. They'll be re-generated next time you run a build, either with `npx expo run:ios`, `npx expo prebuild`, or with EAS Build.
- **If you don't use [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)**:
  - Run `npx pod-install` if you have an `ios` directory.
  - Apply any relevant changes from the [Native project upgrade helper](https://docs.expo.dev/bare/upgrade/?fromSdk=55&toSdk=56).
  - Optionally, you could consider [adopting prebuild](https://docs.expo.dev/guides/adopting-prebuild/) for easier upgrades in the future.
- **If you use [development builds with expo-dev-client](https://docs.expo.dev/develop/development-builds/introduction/)**: Create a new development build after upgrading.
- **If you use Expo Go**: consider migrating to [development builds](https://docs.expo.dev/develop/development-builds/expo-go-to-dev-build/). [Expo Go is not recommended as a development environment for production apps](https://expo.fyi/expo-go-usage).
- **Having trouble?** Refer to the [Troubleshooting your SDK upgrade](https://expo.fyi/troubleshooting-sdk-upgrades) guide.
- **Questions?** Join our weekly office hours on Wednesdays at 12:00PM Pacific [on Discord](https://chat.expo.dev/).

## **Thanks to everyone who contributed to the release!**

Thanks to [the Expo team](https://expo.dev/about) — everyone contributed one way or another.

**External contributors**: [Abhishek Raj](https://github.com/abraj), [Aleksandr Kondrashov](https://github.com/aramikuto), [Alfonso Curbelo](https://github.com/alfonsocj), [Amaury Liet](https://github.com/AmauryLiet), [Andrej Pavlovic](https://github.com/andrejpavlovic), [Arthur Blais](https://github.com/SialB), [Artur Morys - Magiera](https://github.com/artus9033), [Azeem Idrisi](https://github.com/AzeemIdrisi), [azro352](https://github.com/azro352), [benjamin](https://github.com/benschac), [Benjamin Komen](https://github.com/benjaminkomen), [Benjamin Wallberg](https://github.com/bwallberg), [Błażej Kustra](https://github.com/blazejkustra), [C. Obama](https://github.com/CalvinNFT), [CamWass](https://github.com/CamWass), [Choco](https://github.com/Choco-milk-for-u), [Chris Masters](https://github.com/chrism), [Chris Zubak-Skees](https://github.com/chriszs), [Christian Wooldridge](https://github.com/cwooldridge1), [Cristian C.](https://github.com/cibucristi), [Dalibor Belic](https://github.com/daliboru), [Daniel Meyer](https://github.com/pubkey), [Daniel Reichhart](https://github.com/reichhartd), [Danish](https://github.com/danishshaik), [Dave Mkpa-Eke](https://github.com/DaveyEke), [Delphine Bugner](https://github.com/delphinebugner), [Dennis Morello](https://github.com/morellodev), [desii](https://github.com/desii101), [Dimitar Nestorov](https://github.com/DimitarNestorov), [Doğukan Yıldız](https://github.com/dogukany), [Donghoon Nam](https://github.com/codenamenam), [Dwight Watson](https://github.com/dwightwatson), [Dylan](https://github.com/dylancom), [Emil Lindén](https://github.com/emillinden), [Eric Kreutzer](https://github.com/erickreutz), [Eric Zeiberg](https://github.com/EricZeiberg), [Fernando Rojo](https://github.com/nandorojo), [Frank Calise](https://github.com/frankcalise), [Gary Chiu](https://github.com/garygcchiu), [Gregory Moskaliuk](https://github.com/hryhoriiK97), [Gustavo Harff](https://github.com/gustavoharff), [Hugo Extrat](https://github.com/huextrat), [Ian K](https://github.com/ink404), [Isaiah Hamilton](https://github.com/Isaiah-Hamilton), [Jakub Kosmydel](https://github.com/kosmydel), [Jc Cloete](https://github.com/Jc-Cloete), [Jeroen van Warmerdam](https://github.com/jerone), [JeroenG](https://github.com/Jeroen-G), [Jesper Sørensen](https://github.com/jeppester), [John HU](https://github.com/ushuz), [Jonathan Baudanza](https://github.com/jbaudanza), [Jonathan Rivera](https://github.com/jonemilnik), [Joseph Gift](https://github.com/jgmagift), [Julie Saia](https://github.com/juliesaia), [jurajpaska8](https://github.com/jurajpaska8), [K.Dileepa Thushan Peiris](https://github.com/dileepapeiris), [Kazuho Maejima](https://github.com/kzhgit), [Kfir Fitousi](https://github.com/kfirfitousi), [kimchi-developer](https://github.com/kimchi-developer), [Kornelijus Šliubauskas](https://github.com/TheAmphibianX), [Kræn Hansen](https://github.com/kraenhansen), [Krastan Dimitrov](https://github.com/KrastanD), [Kyle Ledbetter](https://github.com/kyleledbetter), [Leonardo E. Dominguez](https://github.com/focux), [leonmetthez](https://github.com/leonmetthez), [Loic CHOLLIER](https://github.com/chollier), [lucabc2000](https://github.com/lucabc2000), [Lucia Sarni](https://github.com/lsarni), [Manu](https://github.com/kamui545), [Matin Zadeh Dolatabad](https://github.com/matinzd), [Matthew Abraham](https://github.com/shottah), [Mauko Quiroga-Alvarado](https://github.com/bonjourmauko), [Maxime](https://github.com/blancham), [Mikołaj Szydłowski](https://github.com/szydlovsky), [Mohammad Amin](https://github.com/mohammadamin16), [Momtchil Momtchev](https://github.com/mmomtchev), [Myagmarsuren](https://github.com/Miigaarino), [Nicholas Pachulski](https://github.com/pachun), [Nick Ater](https://github.com/nickater), [Nicola Corti](https://github.com/cortinico), [Otávio Stasiak](https://github.com/OtavioStasiak), [Patrick Michalik](https://github.com/patrickmichalik), [Patrick Wang](https://github.com/patw0929), [Patryk Mleczek](https://github.com/pmleczek), [Peter Lazar](https://github.com/peterlazar1993), [Petr Chalupa](https://github.com/pchalupa), [Pflaumenbaum](https://github.com/Pflaumenbaum), [Preet Patel](https://github.com/preetpatel), [Randall71](https://github.com/Randall71), [Regi24](https://github.com/Regi24), [roach](https://github.com/tmdgusya), [Rodrigo Leite Araujo](https://github.com/rodrigoaraujo7), [Ronald Goedeke](https://github.com/ronickg), [Samuel Brucksch](https://github.com/SamuelBrucksch), [Samuel Newman](https://github.com/mozzius), [Satyajit Sahoo](https://github.com/satya164), [Sergiy Dybskiy](https://github.com/sergical), [Serhii Pustovit](https://github.com/psnet), [Shane Friedman](https://github.com/smoores-dev), [Shoghy Martinez](https://github.com/Shoghy), [Shubh Porwal](https://github.com/shubh73), [Shubham Shinde](https://github.com/shindeshubhamm), [snowingfox](https://github.com/SnowingFox), [starsky-nev](https://github.com/starsky-nev), [teamclouday](https://github.com/teamclouday), [Terijaki](https://github.com/terijaki), [TheUntraceable](https://github.com/TheUntraceable), [ThiMal](https://github.com/tmallet), [Tomasz Zawadzki](https://github.com/tomekzaw), [Ty Rauber](https://github.com/tyrauber), [Victor Bolivar De la Cruz](https://github.com/victor-bolivar), [Vsevolod Lomovitsky](https://github.com/dwnste), [xoyseau](https://github.com/xoyseau), [yerevin](https://github.com/yerevin), and [Zhovtonizhko Dmitriy](https://github.com/doombladeoff).

**Beta testers**: [Agrit Tiwari](https://github.com/agrittiwari), [Amrit Saini](https://github.com/Amrit0991), [androidanimation](https://github.com/androidanimation), [Anthony Mittaz](https://github.com/sync), [Berhan](https://github.com/berhanserin), [Brandon Austin](https://github.com/branaust), [David Grimsley](https://github.com/DavidJGrimsley), [dylanfcsr](https://github.com/dylanfcsr), [Eduardo Lomelí](https://github.com/eduardinni), [ifx326](https://github.com/tomoakikuroiwa), [Kenji Okura](https://github.com/OkuraKenG), [Kingfapa](https://github.com/Kingfapa), [Lucas Hardt](https://github.com/Luc1412), [Matthew Horan](https://github.com/mhoran), [Max](https://github.com/maxvaljan), [Robrecht Meersman](https://github.com/robrechtme-itp), [Rodolfo Perottoni](https://github.com/rodperottoni), [Simon](https://github.com/simondaigre), and [Sven](https://github.com/H-Sven).

Contents

[Expo UI is now ready for production](#expo-ui-is-now-ready-for-production)[Universal components](#universal-components)[Stable native APIs](#stable-native-apis)[Drop-in replacements for community components](#drop-in-replacements-for-community-components)[Faster native builds](#faster-native-builds)[Precompiled Expo packages on iOS](#precompiled-expo-packages-on-ios)[Precompiled headers for Android codegen (experimental)](#precompiled-headers-for-android-codegen-experimental)[Expo Modules: easier to write, faster to run](#expo-modules-easier-to-write-faster-to-run)[Inline modules](#inline-modules)[Type generation tools](#type-generation-tools)[Revamped create-expo-module](#revamped-create-expo-module)[Runtime performance improvements in expo-modules-core](#runtime-performance-improvements-in-expo-modules-core)[React Native 0.85 and React 19.2](#react-native-085-and-react-192)[Hermes bytecode diffing is now enabled by default](#hermes-bytecode-diffing-is-now-enabled-by-default)[More capable expo-file-system](#more-capable-expo-file-system)[Status bar and navigation bar APIs are now consistent](#status-bar-and-navigation-bar-apis-are-now-consistent)[New Calendar, Contacts, and MediaLibrary APIs are now stable](#new-calendar-contacts-and-medialibrary-apis-are-now-stable)[Widgets for iOS promoted to stable](#widgets-for-ios-promoted-to-stable)[AI-friendly project scaffolding](#ai-friendly-project-scaffolding)[Convex integration](#convex-integration)[Expo CLI](#expo-cli)[Type-safe config plugins](#type-safe-config-plugins)[Expo Router](#expo-router)[New features](#new-features)[Brownfield: more flexibility for embedded Expo apps](#brownfield-more-flexibility-for-embedded-expo-apps)[Expo Application Services (EAS)](#expo-application-services-eas)[Build time statistics for xcodebuild and Gradle](#build-time-statistics-for-xcodebuild-and-gradle)[Prebuilt artifacts for major community libraries](#prebuilt-artifacts-for-major-community-libraries)[Coming soon: EAS Observe](#coming-soon-eas-observe)[Other notable changes](#other-notable-changes)[Deprecations](#deprecations)[Notable breaking changes](#notable-breaking-changes)[Tool version bumps](#tool-version-bumps)[Expo Go](#expo-go)[Known regressions](#known-regressions)[Upgrading your app](#upgrading-your-app)[Thanks to everyone who contributed to the release!](#thanks-to-everyone-who-contributed-to-the-release)

