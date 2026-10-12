---
source: https://expo.dev/changelog/sdk-54 (expo.dev changelog page; not in a GitHub repo, fetched as HTML and converted with pandoc)
fetched: 2026-10-12
repo_sha: n/a (live page on expo.dev, fetched 2026-10-12)
---

# Expo SDK 54

SEP 10, 2025

![Alan Hughes](https://cdn.sanity.io/images/9r24npb8/production/fbc6f8287ef11f9f25db8039fee4ea8445dd7fe2-460x460.jpg?auto=format&fit=max&q=75&w=24)Alan Hughes

![Brent Vatne](https://cdn.sanity.io/images/9r24npb8/production/6aa3e387c3c72e9774c61a8398bbc2f9c427270a-400x400.webp?auto=format&fit=max&q=75&w=24)Brent Vatne

Share



Contents

Share post

[Precompiled React Native for iOS](#precompiled-react-native-for-ios)[iOS 26 and Liquid Glass](#ios-26-and-liquid-glass)[Support for Liquid Glass icons and Icon Composer](#support-for-liquid-glass-icons-and-icon-composer)[Using Liquid Glass views in your app](#using-liquid-glass-views-in-your-app)[Using UIKit (best choice for most Expo apps today)](#using-uikit-best-choice-for-most-expo-apps-today)[Using SwiftUI (try out our beta Expo UI library!)](#using-swiftui-try-out-our-beta-expo-ui-library)[Xcode 26 and Liquid Glass](#xcode-26-and-liquid-glass)[React Native for Android now targets Android 16 / API 36](#react-native-for-android-now-targets-android-16--api-36)[Edge-to-edge is now always enabled](#edge-to-edge-is-now-always-enabled)[Predictive back gesture available as opt-in](#predictive-back-gestureavailable-as-opt-in)[Expo Updates & EAS Update](#expo-updates--eas-update)[Improved package manager support and Expo Autolinking revamp](#improved-package-manager-support-and-expo-autolinking-revamp)[SDK 54 is the final release to include Legacy Architecture support](#sdk-54-is-the-final-release-to-include-legacy-architecture-support)[Highlights](#highlights)[Apple and Android TV](#apple-and-android-tv)[Expo CLI](#expo-cli)[Expo Router](#expo-router)[Deprecations & removals](#deprecations--removals)[Notable breaking changes](#notable-breaking-changes)[Tool version bumps](#tool-version-bumps)[Known issues](#known-issues)[➡️ Upgrading your app](#️-upgrading-your-app)[Thanks to everyone who contributed to the release!](#thanks-to-everyone-who-contributed-to-the-release)[Additional resources](#additional-resources)





Today we're announcing the release of Expo SDK 54. SDK 54 includes React Native 0.81. Thank you to everyone who helped with beta testing.

![Expo SDK 54 is released. SDK 54 includes React Native 0.81](https://cdn.sanity.io/images/9r24npb8/production/40740e1b2fa8be08e72adfc68c2edd1eef56503d-3600x2025.png?auto=format&fit=max&q=75&w=1200)

## Precompiled React Native for iOS

Starting with React Native 0.81 and Expo SDK 54, React Native on iOS and its dependencies will be shipped as precompiled XCFrameworks alongside the source.

![Visualization of layers of an app](https://cdn.sanity.io/images/9r24npb8/production/6556b853aea1445b48d621bd3f3e046d4dfd4520-2400x1349.png?auto=format&fit=max&q=75&w=800)

> We’ve found that \[using the precompiled XCFrameworks\] reduced clean build times for [RNTester](https://github.com/facebook/react-native/blob/main/packages/rn-tester/README.md) from about 120 seconds to 10 seconds (on an M4 Max — exact numbers will vary depending on your machine specs). While *you’re unlikely to see a ~10x build time improvement in your app* due to the number of other dependencies in most apps that will still need to be compiled, we expect a noticeable reduction in build times in large projects and an even more pronounced improvement in smaller projects where React Native is responsible for a greater share of the build time.

In addition to the speed benefits, this improvement brings us closer to being able to move from CocoaPods to Swift Package Manager for React Native and Expo projects.

Note that if your app uses `use_frameworks!` in your **Podfile** (or `useFrameworks` in `expo-build-properties`), it will always build from source and you won't be able to take advantage of this improvement yet. We hope to add support for this case in the near future.

Learn more in [**Precompiled React Native for iOS: Faster builds are coming in 0.81**](https://expo.dev/blog/precompiled-react-native-for-ios).

## iOS 26 and Liquid Glass

### Support for Liquid Glass icons and Icon Composer

![Icon Composer app with an Expo app icon](https://cdn.sanity.io/images/9r24npb8/production/2a9502eb970f8224ce260c45163ea0b5be1d2216-1672x1072.png?auto=format&fit=max&q=75&w=800)

SDK 54 adds support for iOS 26 Liquid Glass icons, which you can create using the new [Icon Composer](https://developer.apple.com/icon-composer/) app. The Icon Composer app produces a `.icon` file, which you can reference in your **app.json** under the `ios.icon` key:

\
It’s important to note that the Icon Composer app is macOS only — if you don’t have access to a macOS machine that can run the app, then you won’t be able to take advantage of the UI for building the icons. However, the output is relatively straightforward JSON and it’s possible that a tool will emerge to handle this.

When your app using this icon format is run on an older iOS version (iOS ≤ 19), an appropriate fallback will be automatically provided by the operating system.

### Using Liquid Glass views in your app

![Screenshots showing Liquid Glass effects](https://cdn.sanity.io/images/9r24npb8/production/b3cdd049bbaa7efc989c4a278cef26efe79ca9f6-2400x1350.png?auto=format&fit=max&q=75&w=800)

See these effects live on [this YouTube short](https://www.youtube.com/shorts/3NaUXh-RqEQ). Also notice the iOS 26 bottom tabs UI — this is available in Expo Router v6. See the Expo Router section below for more information.

#### Using UIKit (best choice for most Expo apps today)

You can use Liquid Glass views seamlessly in your app with the new `expo-glass-effect` library and its `<GlassView>` and `<GlassContainer>` views, which are built on [UIVisualEffectView](https://developer.apple.com/documentation/uikit/uivisualeffectview). [Learn more about expo-glass-effect](https://docs.expo.dev/versions/v54.0.0/sdk/glass-effect/).

#### Using SwiftUI (try out our beta Expo UI library!)

Expo UI for iOS, a library that gives you SwiftUI primitives in your Expo app, is now in beta. This release includes [a brand new guide in the docs](https://docs.expo.dev/guides/expo-ui-swift-ui/) in addition to support for Liquid Glass SwiftUI modifiers, button variants, and much more.

### Xcode 26 and Liquid Glass

Compiling your project with Xcode 26 is required if you plan to take advantage of the iOS 26 features mentioned above.

EAS Build and Workflows will default to using Xcode 26 for SDK 54 projects. If you are building your project on your own machine, you can download the latest version of Xcode from the [Apple Developer Releases page](https://developer.apple.com/news/releases/). Xcode 26 is currently in RC status, and the GM should be released by Apple on September 15. By building your app with Xcode 26 now, you can ensure it is ready for iOS 26 immediately on its release (also on September 15). A new version of Expo Go that is built with Xcode 26 will be available shortly.

## React Native for Android now targets Android 16 / API 36

### Edge-to-edge is now always enabled

With Expo SDK 54 and React Native 0.81 now targeting Android 16, [**edge-to-edge will be enabled in all Android apps, and cannot be disabled**](https://developer.android.com/about/versions/16/behavior-changes-16#edge-to-edge). Additionally, `react-native-edge-to-edge` is no longer a dependency of the `expo` package because the required functionality was built into React Native by the author of the library, [Mathieu Acthernoene](https://github.com/zoontek). If you are using the `react-native-edge-to-edge` config plugin to configure edge-to-edge in your project, make sure that the package is a direct dependency of your project (`npx expo install react-native-edge-to-edge`). If you were only using the plugin only to configure the [`enforceNavigationBarContrast`](https://github.com/zoontek/react-native-edge-to-edge#:~:text=%22enforceNavigationBarContrast%22%3A%20false) option you can use the new `androidNavigationBar.enforceContrast` property in your **app.json** to get the same effect without additional dependencies.

### Predictive back gesture available as opt-in

The Android predictive back gesture feature is disabled by default in all projects in SDK 54, and you can enable it in your project's **app.json** with [`android.predictiveBackGestureEnabled`](https://docs.expo.dev/versions/v54.0.0/config/app/#predictivebackgestureenabled). As with edge-to-edge, we expect opt-outs will eventually be removed from a future version of Android, and we plan to enable this by default in all projects in SDK 55 or 56. [Learn more](https://developer.android.com/about/versions/16/behavior-changes-16#predictive-back).

## Expo Updates & EAS Update

- **The HTTP headers Update sends, such as channel, can now be overridden at runtime with `Updates.setUpdateRequestHeadersOverride()`**. This enables developers to easily implement patterns such as opting employees into a different update channel than end-users. Unlike `Updates.setUpdateURLAndRequestHeadersOverride()` , which allows you to also override the update URL and requires the [`disableAntiBrickingMeasures`](https://docs.expo.dev/eas-update/override/#security-considerations) build time flag — the new method only applies to headers, is available without setting any flags, and can be used safely in production apps. Configuration set with either method will apply immediately to the currently running app. This means that you don’t need to restart the app for the new configuration to take effect, you can call `Updates.fetchUpdateAsync()` and `Updates.reloadAsync()` after you update the headers. [Learn more about overriding request headers](https://docs.expo.dev/eas-update/override/#override-request-headers).
- **The `useUpdates()` hook now includes a `downloadProgress` property, which you can use to track the progress of asset downloads during an update.** You can use this to show a progress bar when downloading an update, and possibly other creative scenarios. [Learn more](https://docs.expo.dev/versions/v54.0.0/sdk/updates/#useupdatesreturntype).
- **`Updates.reloadAsync()` now accepts [`reloadScreenOptions`](https://docs.expo.dev/versions/v54.0.0/sdk/updates/#reloadscreenoptions) to give developers control over the UI that is presented while your app is reloading.** This provides a much better user experience than a flash of empty content. The following example configuration shows a full screen image and fades out when the update has been applied: In development, you can test your reload screen configuration by using `Updates.showReloadScreen({ reloadScreenOptions })` and `Updates.hideReloadScreen()`.

Example of using the new Update reload screen API

## Improved package manager support and Expo Autolinking revamp

We’ve worked on improving the reliability of running Expo projects with package managers supporting workspaces (monorepos), with isolated dependency installations and when your dependencies have active hoisting conflicts. To support this, several changes were made to **Expo Autolinking**, as well:

- **React Native modules that are installed as transitive dependencies will now be autolinked.** While Expo Autolinking always worked this way *for Expo modules*, now that we take care of linking React Native modules, (as of SDK 52) we were able to implement this behavior *for React Native modules* as well. This means that you will be able to let libraries take care of managing their dependencies, rather than copying and pasting a command to install a handful of native dependencies on their behalf ([learn more](https://github.com/react-native-community/cli/issues/870)). You can revert back to the previous autolinking behavior by adding the `expo.autolinking.legacy_shallowReactNativeLinking: true` flag in your app’s **package.json**.
- **Expo and React Native modules will now link according to your app’s direct and nested dependencies,** rather than them scanning your **node_modules** folders. Now, either your app or a dependency of your app will need to contain a native module in their `dependencies` or `peerDependencies` for it to be linked. You can revert back to the previous autolinking behavior by adding your **node_modules** folders to `expo.autolinking.searchPaths` in your app’s **package.json**.
- **Expo Autolinking now has unified behavior across Expo and React Native modules**, and so it will behave more predictably when it comes to isolated dependency installations (Bun and pnpm) and hoisting conflicts.

Changes that impact how dependencies are handled will often lead to issues in more unique project configurations that can't be anticipated. You can verify your expected native modules against the output of `npx expo-modules-autolinking verify -v` , or with Expo Doctor proactively, if you believe they may be impacted by these changes. If you need to opt out of the autolinking changes mentioned above, add the following to your app’s **package.json**:

While these changes affect native modules linking, they may also now be applied experimentally to Expo CLI’s bundling, which can actively help in resolving native module duplicates or allow multiple versions of React or a native module to be installed in a single monorepo. Set `experiments.autolinkingModuleResolution` to `true` in **app.json** to test this.

All popular package managers (Bun, npm, pnpm, and Yarn) are now supported, our monorepo instructions have been updated, and Expo Doctor and the Expo CLI have been updated accordingly.

## SDK 54 is the final release to include Legacy Architecture support

In React Native 0.80, the React Native team [introduced a code freeze on the Legacy Architecture](https://reactnative.dev/blog/2025/06/12/react-native-0.80#legacy-architecture-freezing--warnings). In React Native 0.82, [it will no longer be possible to opt out of the New Architecture](https://github.com/facebook/react-native/pull/53026). This means that SDK 55, which will likely include React Native 0.83, only support the New Architecture.

In recent months, a growing number of libraries have started to only support the new architecture. For example: [`react-native-reanimated` v4](https://blog.swmansion.com/reanimated-4-stable-release-the-future-of-react-native-animations-ba68210c3713) and [`@shopify/react-native-flashlist` v2](https://shopify.engineering/flashlist-v2). The interop layer will remain a part of React Native for the foreseeable future, in order to ensure that libraries built for the Legacy Architecture continue to work well in modern apps.

At the time of writing, 75% of SDK 53 projects built on EAS use the New Architecture. If you are still concerned about migrating, [learn more about work that has been done](https://github.com/expo/fyi/blob/main/new-arch-sdk-54-status.md) to address the last remaining identified issues found while migrating some of the largest React Native apps, [such as the primary Shopify app and their Point of Sale app](https://shopify.engineering/react-native-new-architecture), which "\[serve\] millions of merchants”.

## Highlights

- **React Native 0.81 with React 19.1**. Refer to the release notes for [React Native 0.81](https://reactnative.dev/blog/2025/08/12/react-native-0.81) and [React 19.1](https://github.com/facebook/react/releases/tag/v19.1.0) changelog for detailed information. Also, learn more about the [Expo SDK policy for tracking React Native versions.](https://docs.expo.dev/versions/latest#expo-sdk-policy-for-tracking-react-native)
- **expo-file-system/next is stable:** The [new expo-file-system API](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/) is now stable and exposed as a default. If you were using it prior to upgrading, you will need to update your imports from `expo-file-system/next` → `expo-file-system`. The old API is still available under [`expo-file-system/legacy`](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem-legacy/). Some improvements include: an object-oriented API for working with files and directories, support SAF URIs on Android and bundled assets on both iOS and Android. You can expect more information in an upcoming blog post, in the meantime you can refer to the [API reference](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/).
- **expo-sqlite now includes a drop-in implementation for the [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) web API**. If you're already familiar with this API from the web, or you would like to be able to share storage code between web and other platforms, this may be useful. [Learn how to import and install the localStorage API.](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/#the-localstorage-api)
- **Prebuild template now included in the `expo` package rather than downloaded from npm.** This ensures that the template used by a given `expo` package version remains unchanged even if new template versions are released. Updating the `expo` package will also bring in a new template version. Thanks to [Thibault Malbranche](https://github.com/titozzz) for suggesting this change. Note that you can still provide a custom prebuild template with the `--template` flag.
- **expo-sqlite added `loadExtensionAsync()` and `loadExtensionSync()` APIs to support loading [SQLite extensions](https://www.sqlite.org/loadext.html)**. The [sqlite-vec](https://github.com/asg017/sqlite-vec) extension, which supports vector data processing, is also bundled to expo-sqlite as an opt-in extension. You can use sqlite-vec for some RAG AI work. See the implementation in [expo#38693,](https://github.com/expo/expo/pull/38693) for [`loadExtensionAsync()` API usage](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/#loadextensionasynclibpath-entrypoint), the [`withSQLiteVecExtension` config-plugin option to opt-in sqlite-vec](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/#configurable-properties).
- **expo-app-integrity**: New package for verifying app integrity using DeviceCheck (`DCAppAttestService`) on iOS and the Play Integrity API on Android. This allows you to confirm that the app is installed via the App Store or Play Store and is running on a genuine, untampered device. [Learn more.](https://docs.expo.dev/versions/v54.0.0/sdk/app-integrity/)
- **expo/blob:** New package for working with binary large objects on iOS and Android. Our implementation is consistent with the [W3C](https://w3c.github.io/FileAPI/#dfn-Blob) specification, providing you with interfaces familiar from the web. `expo-blob` is now in beta, and we’re excited to get your feedback! This library is not yet included in Expo Go.
- **expo-maps:** Added support for JSON and Google Cloud based map ID styling on Google Maps and Points of Interest (POI) filtering on Apple maps. [Learn more](https://docs.expo.dev/versions/v54.0.0/sdk/maps/).
- **`buildCacheProvider` promoted from experimental to stable.** When using a build cache provider, `npx expo run:[android|ios]` will automatically download your project's most recent build with the same [fingerprint](https://expo.dev/blog/fingerprint-your-native-runtime), if it exists. If there is no build for the fingerprint yet, then `npx expo run` will continue as usual and compile your project, and then upload the build to the cache provider after launching it. Out-of-the-box integrations are available with [GitHub](https://github.com/expo/examples/tree/master/with-github-remote-build-cache-provider) and [EAS](https://docs.expo.dev/guides/cache-builds-remotely/#using-eas-as-a-build-provider), and you can implement your own custom provider to cache builds in your preferred location (you could even just copy it to a NAS if you want). If you already have EAS configured in your project, run `npx expo install eas-build-cache-provider` and then add `"buildCacheProvider": "eas"` to your **app.json** - that's it! Once you've set this up, [you can also use `eas fingerprint:compare` to easily understand](https://expo.dev/blog/understanding-and-comparing-fingerprints-in-expo-apps) what caused your fingerprint to change. [Learn more about using GitHub and EAS build cache providers, and creating your own](https://docs.expo.dev/guides/cache-builds-remotely/).
- **Improvements to brownfield experience, and more on the way.** We are continuously improving the brownfield experience, and rewriting our documentation on native app integration. We've also added support custom folder structures, which is especially useful for large codebases where moving native projects to **android** and **ios** directories isn't feasible. [Learn more](https://docs.expo.dev/brownfield/get-started/).
- [**Expo Go is now available for the Meta Quest on the Horizon Store**](https://www.meta.com/experiences/expo-go/25322546364000780/). We've seen some massive improvements to the platform over the past year and we're excited for more existing Android apps get up and running as 2D apps on the Meta Quest. It's not meaningfully different from getting an Android app running on other Android platforms without Google Services, and you can expect to hear more from us and from the team at Meta about this in the near future. [Reach out](mailto:brent@expo.dev) if you are interested in getting your Android app deployed to Quest devices, we'd be happy to discuss it.
- **expo-dev-launcher rewrite:** we rebuilt the expo-dev-client UI in order to simplify the interface with React Native and improve the Hermes debugging experience. In doing so, we also made some other improvements to the look and feel — let us know what you think!

![Screenshots of the revamped dev menu](https://cdn.sanity.io/images/9r24npb8/production/aac31d45c1acdc74bb100a8497a03fb6fb306672-2400x1350.png?auto=format&fit=max&q=75&w=800)

## Apple and Android TV

- **Experimental expo-dev-client support for Apple TV, full support on Android TV.** Support on tvOS is still early, and you can’t yet authenticate with your Expo account in the app, but give it a try if you have an Apple TV and let us know what you think.
- **Added support for Apple TV in various SDK packages:** expo-sqlite, expo-background-task, expo-task-manager, expo-insights, expo-image-loader, expo-image-manipulator, and expo-video-thumbnails. See the doc pages for the individual packages for more details.
- **tvOS builds will leverage the new precompiled frameworks provided in React Native 0.81:** This will [significantly reduce build times for these platforms](https://www.youtube.com/shorts/YDCVUj6TbdU) ([related blog](https://expo.dev/blog/precompiled-react-native-for-ios)).

## Expo CLI

![Import stack comparisons](https://cdn.sanity.io/images/9r24npb8/production/8f0c04da8eb8554f7dccf27a137953e8869f44fe-1920x1080.png?auto=format&fit=max&q=75&w=800)

- **Import stack traces are now enabled by default.** You can now see a list of imports leading to a missing module which makes it much easier to trace broken packages. With this feature, we found agents (such as claude code) could always resolve broken imports.
- **`experimentalImportSupport` is now enabled by default.** We’ve rebuilt Metro ESM support in Expo CLI to better support [React Compiler](https://docs.expo.dev/guides/react-compiler/), and [tree shaking](https://docs.expo.dev/guides/tree-shaking/#enabling-tree-shaking). This moves us one step closer to full ESM support in Expo.
  - You can revert to the older system by setting `experimentalImportSupport: false` in the **metro.config.js**. We plan to remove this flag altogether in the next SDK release.
  - The rebuilt support uses live bindings by default to improve compliance with the ECMAScript specification and to support a wide range of projects. If you don't want this, set [`EXPO_UNSTABLE_LIVE_BINDINGS=false`](https://docs.expo.dev/more/expo-cli/#environment-variables). Disabling live bindings will cause issues with many projects, and will break circular import support.
- **Expo CLI now auto-prefixes CSS by default using the Rust-based `lightningcss`**. You can remove `autoprefixer` from your `postcss.config.mjs` file in favor of this implementation. We’ve also added support for `browserslist` in the package.json for CSS prefxi. [Learn more](https://docs.expo.dev/versions/unversioned/config/metro/#browserslist).
- `@babel/plugin-transform-class-static-block` is now added to babel-preset-expo by default. This enables an even wider set of web and server libraries to work with Expo by default. [Learn more about static class blocks](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Static_initialization_blocks).
- **React Compiler is now enabled in the default template**. We recommend using it in your projects. The Meta team is actively fielding support for any remaining issues with React Compiler. You can see which components are memoized by pressing J in Expo CLI and going to the components panel. You will see “Experimental React Compiler is enabled.” printed in your logs when you run `npx expo start` — this is because it is currently in Release Candidate. However, we believe it is ready for most apps. This default may change if this proves false during the beta period. Learn more in the [Expo + React Compiler docs.](https://docs.expo.dev/guides/react-compiler/)
- **React Native owner stacks are now enabled by default**. These improve errors that occur in React components and make it easier to find/fix problems for both humans and agents.
- **Unhandled promise rejections are now logged as errors**. After upgrading to this SDK, you might notice new promise rejection errors in your mobile applications. These aren't caused by the SDK itself, but are now properly surfaced as errors, which aligns with how Promises work in web browsers.
- **Experimental autolinking module resolution was added**. Expo CLI is now able to apply Expo Autolinking’s linking decisions to JavaScript module resolution. This prevents mismatches between native modules and JavaScript modules, even in the presence of dependency conflicts and duplicates, and also resolves `react` and `react-dom` to a single version. Set `experiments.autolinkingModuleResolution` to `true` in **app.json** to test this.
- **Bumped the recommend TypeScript version** to `~5.9.2`
- **Reminder from SDK 53**: The import.meta transform plugin is still an experimental opt-in feature, which you can turn on with the `unstable_transformImportMeta` option in the `babel-preset-expo` configuration ([example](https://gist.github.com/Kudo/39041f31f3a055442f9200540e8da649)). Enable this if some of your ESM dependencies rely on `import.meta`.

## Expo Router

Expo Router v6 - Link Previews

- **Link now supports iOS view controller previews, transitions, and context menu items**. These can be used to add quick actions and information to any link in your app. [Learn more](https://docs.expo.dev/router/reference/link-preview/).
- **Beta support for native tabs on iOS and Android**. Unlike the JS tabs implementation, this enables liquid glass tabs, automatic scrolling on tab press, and many other beautiful native effects. The API is still under development and subject to breaking changes until we remove the `unstable-` prefix from the import. [Learn more](https://docs.expo.dev/router/advanced/native-tabs/).
- **Modals on web now emulate iPad and iPhone behavior** instead of just being a full screen page with no modal-like attributes.
- **New experimental server middleware support**. Middleware can be used to run code before requests reach a route. [Learn more](https://docs.expo.dev/router/reference/middleware/).
- **`TextDecoderStream` and `TextEncoderStream` are added to the native runtime** to better support fetch streaming and working with AI.

## Deprecations & removals

- `expo-build-properties` field `enableProguardInReleaseBuilds` is deprecated in favor of `enableMinifyInReleaseBuilds`.
- **React Native’s `<SafeAreaView>` component has been deprecated**: use [`react-native-safe-area-context`](https://docs.expo.dev/versions/latest/sdk/safe-area-context/) instead if you aren’t already. It’s a much more powerful alternative, and one of those libraries that nearly every app uses.
- **The `notification` [configuration field](https://docs.expo.dev/versions/v54.0.0/config/app/#notification) in app config has been deprecated in favor of `expo-notifications` config plugin**.
- **`expo-av` will be removed in SDK 55**. It was deprecated in SDK 53, and this will be the last SDK release where it will be a part of the SDK. Migrate to `expo-audio` and `expo-video`.

## Notable breaking changes

- **First-party JSC support removed from React Native**: React Native 0.81 no longer provides built-in JSC support — if you would like to continue using JSC, refer to [https://github.com/react-native-community/javascriptcore](https://github.com/react-native-community/javascriptcore). Note: this community-maintained JSC library [does not yet provide a config plugin](https://github.com/react-native-community/javascriptcore/issues/14), and so you will need to either write your own or modify your native projects directly in order to use it.
- **Reanimated v4 introduces `react-native-worklets`and only supports the New Architecture.** Refer to the [Reanimated 3.x to 4.x migration guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/), but skip modifying your **babel.config.js** (this is handled automatically by `babel-preset-expo`). *If you need to continue using the Legacy Architecture*, you can continue using Reanimated v3 — [learn how to use Reanimated v3 with SDK 54](https://github.com/expo/fyi/blob/main/expo-54-reanimated.md#using-sdk-54-with-legacy-architecture).
- **Internal Metro imports [have changed in metro@0.83](https://github.com/facebook/metro/pull/1530)**. Importing internals from `metro/src/..` is not longer supported. Internals are now only accessible via `metro/private/..`. For most app developers, this won’t impact you. If you maintain a library or app that interacts with Metro directly, please switch to Metro’s public APIs. If you use a library that runs into an error due to `src` imports, open an issue on the library’s GitHub issues.
- **expo-file-system legacy API now available through `expo-file-system/legacy` and the default exports for the library were replaced with what was formerly `expo-file-system/next` .** The quickest way to upgrade and have your app working the same as before is to replace all imports for `expo-file-system` to `expo-file-system/legacy`. Next, you can migrate to the new API at your own pace. If you were already using `expo-file-system/next`, update your imports to `expo-file-system` instead (the old imports will still work, but you will be warned). We plan to `expo-file-system/legacy` in SDK 55. [Learn more about the new API](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/).
- **expo-notifications** deprecated function exports were removed [expo/expo#38782](https://github.com/expo/expo/pull/38782).
- **@expo/vector-icons icon families updated to the latest versions from react-native-vector-icons.** If you use TypeScript in your project, typecheck the your project after upgrading to see if any of the icons that you use were renamed or removed.
- **The [locales configuration field](https://docs.expo.dev/guides/localization/#translating-app-metadata) in app config now supports both Android and iOS**. Move translation strings specific to iOS under the `locales.ios` key.

## Tool version bumps

- **Minimum Xcode bumped to 16.1.** Xcode 26 is recommended**.**
- **Minimum Node version bumped to 20.19.4.**

## Known issues

- **Precompiled React Native for iOS is not compatible with `use_frameworks!`**. When using `use_frameworks!`, React Native for iOS will always build from source.
- Found an issue? [Report it](https://github.com/expo/expo/issues/new?assignees=&labels=needs+review&template=bug_report.yml).

## ➡️ Upgrading your app

Here's how to upgrade your app to Expo SDK 54 from 53:

- **Update to the latest version of EAS CLI** (if you use it):

- **Upgrade all dependencies to match SDK 54**:

- **If you have any** **`resolutions`/`overrides`** **in your package.json, verify that they are still needed.** For example, you should remove `metro` and `metro-resolver` overrides if you added them for `expo-router` in a previous SDK release. Additionally, if you previously configured your **metro.config.js** to work well in a monorepo, we recommend reading the updated [Work with monorepos guide](https://docs.expo.dev/guides/monorepos/) to see if you need to make any changes
- **Check for any possible known issues**:

- **Refer to the** [**"Deprecations, renamings, and removals"**](https://expo.dev/changelog/sdk-53#deprecations-renamings-and-removals) **section** above for breaking changes that are most likely to impact your app.
- **Make sure to check the** [**changelog**](https://github.com/expo/expo/blob/main/CHANGELOG.md) **for all other breaking changes!**
- **Upgrade Xcode if needed**: Xcode 16.1 or higher is needed to compile a native iOS project. We recommend Xcode 26 for SDK 54. For EAS Build and Workflows, projects without any specified `image` will default to Xcode 26.
- **If you use** [**Continuous Native Generation**](https://docs.expo.dev/workflow/continuous-native-generation/):
  - Delete the **android** and **ios** directories if you generated them for a previous SDK version in your local project directory. They'll be re-generated next time you run a build, either with `npx expo run:ios`, `npx expo prebuild`, or with EAS Build.
- **If you don't use** [**Continuous Native Generation**](https://docs.expo.dev/workflow/continuous-native-generation/):
  - Run `npx pod-install` if you have an `ios` directory.
  - Apply any relevant changes from the [Native project upgrade helper](https://docs.expo.dev/bare/upgrade/).
  - Optionally, you could consider [adopting prebuild](https://docs.expo.dev/guides/adopting-prebuild/) for easier upgrades in the future.
- **If you use** [**development builds with expo-dev-client**](https://docs.expo.dev/development/introduction/): Create a new development build after upgrading.
- **If you use Expo Go**: Consider migrating to a development builds. [Expo Go is not recommended as a development environment for production apps](https://expo.fyi/expo-go-usage).
- **Having trouble?** Refer to the [Troubleshooting your SDK upgrade](https://expo.fyi/troubleshooting-sdk-upgrades) guide.
- **Questions?** Join our weekly office hours on Wednesdays at 12:00PM Pacific [on Discord](https://chat.expo.dev/).

## Thanks to everyone who contributed to the release\!

**The team**, in no particular order: [everyone](https://expo.dev/about) contributed one way or another, with special mentions to the engineers most directly involved in this release: [Alan Hughes](https://github.com/alanjhughes), [Aleksander Mikucki](https://github.com/aleqsio), [Cedric van Putten](https://github.com/bycedric), [Christian Falch](https://github.com/chrfalch), [Doug Lowder](https://github.com/douglowder), [Evan Bacon](https://github.com/EvanBacon), [Gabriel Donadel](https://github.com/gabrieldonadel), [Jakub Grzywacz](https://github.com/jakex7), [Kudo Chien](https://github.com/kudo), [Łukasz Kosmaty](https://github.com/lukmccall), [Phil Pluckthun](https://github.com/kitten), [Vojtech Novak](https://github.com/vonovak), and [Wojciech Dróżdż](https://github.com/behenate). Other contributors include [Aman Mittal](https://github.com/amandeepmittal), [Beto Moedano](https://github.com/betomoedano), [Jacob Clausen](https://github.com/entiendoNull), [Kadi Kraman](https://github.com/kadikraman), [Keith Kurak](https://github.com/keith-kurak), [Quin Jung](https://github.com/quinlanj), and [Will Schurman](https://github.com/wschurman). Welcome [Nishan Bende](https://github.com/intergalacticspacehighway), [Hirbod Mirjavadi](https://github.com/hirbod), [Krystof Woldrich](https://github.com/krystofwoldrich), [Jakub Tkacz](https://github.com/ubax), [Hassan Khan](https://github.com/hassankhan/), and [Wiktor Smaga](https://github.com/Wenszel)!

**External contributors**, in no particular order: [A.](https://github.com/alexjavascript), [Abdullah Mzaien](https://github.com/mzaien), [Abdulrahman Alfawal](https://github.com/alfawal), [Abdurrahman Rajab](https://github.com/a0m0rajab), [Adzka Fahmi](https://github.com/Fahmousss), [Aleksei Voronin](https://github.com/mmev), [Alex Ott](https://github.com/AlexanderHott), [Alex Toudic](https://github.com/alextoudic), [Amaury Liet](https://github.com/AmauryLiet), [Andrew](https://github.com/meatnordrink), [Andrew Coates](https://github.com/acoates-ms), [Andrew Smith](https://github.com/emertechie), [Aniket Jayateerth](https://github.com/andipro123), [Ankit Agarwal](https://github.com/ankitaggarwal158), [Anton Hudz](https://github.com/antonhudz), [Artur Gęsiarz](https://github.com/arturgesiarz), [Bartosz Szar](https://github.com/szarbartosz), [Bradley Ayers](https://github.com/bradleyayers), [Broda Noel](https://github.com/BrodaNoel), [Cameron Hashemi](https://github.com/camhashemi), [ChrisKyle](https://github.com/ViaAnthroposBenevolentia), [Clark Gredoña](https://github.com/clarkg), [Dan](https://github.com/aladine), [Daniel O’Connor](https://github.com/danoc), [Daniel Williams](https://github.com/dannyhw), [David Guerin](https://github.com/Daavidaviid), [Dawid Matyjasik](https://github.com/dawidmatyjasik), [Dominik Miskovic](https://github.com/dominik-miskovic), [Drew Radcliff](https://github.com/drewradcliff), [Filipe Juan](https://github.com/filipejuan), [Frank Calise](https://github.com/frankcalise), [Gregory Moskaliuk](https://github.com/hryhoriiK97), [Guilherme D'Alessandro](https://github.com/ouwargui), [Gurneer Bedi](https://github.com/gurneerbedi), [Gustavo Harff](https://github.com/gustavoharff), [Hamzat Victor Oluwabori](https://github.com/Code-Victor), [Hanno J. Gödecke](https://github.com/hannojg), [Henrik](https://github.com/henkethebenke), [Hezekiel Tamire](https://github.com/HezekielT), [Hippo Shark](https://github.com/Hipposhark), [Hugo EXTRAT](https://github.com/huextrat), [Hyo](https://github.com/hyochan), [Hyungu Kang \| Airen](https://github.com/bang9), [Jakub Kosmydel](https://github.com/kosmydel), [Jakub Tkacz](https://github.com/Ubax), [Janic Duplessis](https://github.com/janicduplessis), [Jonathan Mazin](https://github.com/jmazin), [Josh Stern](https://github.com/JoshStern), [Julian Dueck](https://github.com/julian-dueck), [Julien Henrotte](https://github.com/JulienHe), [Kid](https://github.com/kidonng), [Leon Horlings](https://github.com/leonhh), [Lucas Bortoli](https://github.com/bortolilucas), [Lucas Ferrari](https://github.com/LucasWithBoots), [Lucas Novelo](https://github.com/lucasnovelo), [Manish Paudel](https://github.com/mpadel78), [Marlin Ranasinghe](https://github.com/MarlzRana), [Mateo Guzmán](https://github.com/mateoguzmana), [Mike Bifulco](https://github.com/mbifulco), [Mohammad Amin](https://github.com/mohammadamin16), [Nutcase](https://github.com/nutcas3), [Ovidiu Cristescu](https://github.com/LunatiqueCoder), [Parth Parmar](https://github.com/Code-Parth), [Pavlo Hromov](https://github.com/hromovp), [Pavlos Vinieratos](https://github.com/pvinis), [Petr Chalupa](https://github.com/pchalupa), [Petr Konecny](https://github.com/petrkonecny2), [Pflaumenbaum](https://github.com/Pflaumenbaum), [Phil Bazun](https://github.com/Phil9l), [Pino Kokol](https://github.com/pinokokol), [Prathamesh More](https://github.com/prathameshmm02), [Prince Mittal](https://github.com/Prince-Mittal), [Priyav K Kaneria](https://github.com/PriyavKaneria), [Radek Czemerys](https://github.com/radko93), [Raku](https://github.com/rakutek), [Ramon](https://github.com/ramonfabrega), [Randall71](https://github.com/Randall71), [Rebakure🔭](https://github.com/KevinRebakure), [Roger Braunstein \[Scopely\]](https://github.com/roger-scopely), [Russ Savage](https://github.com/russorat), [Sebastian Hollington](https://github.com/shollington-rbi), [Steven Eubank](https://github.com/smeubank), [Suleyman](https://github.com/solmanter), [Sávio Carlos Martins Costa](https://github.com/saviocmc), [Ted Summer](https://github.com/macintoshpie), [Thibault Malbranche](https://github.com/Titozzz), [Tomasz Żelawski](https://github.com/tjzel), [Tyler Scott Williams](https://github.com/coolsoftwaretyler), [Vadko](https://github.com/Vadko), [Xiaohan Li](https://github.com/hansnow), [Yatendra](https://github.com/sharmayatendra), [adiktiv](https://github.com/adiktiv), [charlotte ✨](https://github.com/char), [desii](https://github.com/desii101), [katayama8000](https://github.com/katayama8000), [mo](https://github.com/KKingmo), [sanchezg7](https://github.com/sanchezg7)

**Beta testers:** [Thibault Malbranche](https://github.com/Titozzz), [Patrik Duksin](https://github.com/patrikduksin), [Charlie](https://github.com/chartliex), [MrFunctor](https://github.com/MrFunctor), [Max](https://github.com/maxvaljan), [Kasymbekov Sultanmyrza](https://github.com/sultanmyrza), [Delgermurun](https://github.com/Deegiimurun), [Nitesh](https://github.com/niteshbalusu11), [Tyler Scott Williams](https://github.com/coolsoftwaretyler), [Vincent Fleming](https://github.com/flemingvincent), [Chris Zubak-Skees](https://github.com/chriszs), [Patrick Weisensee](https://github.com/pweisensee), and many more!

## Additional resources

If you'd like to watch a summary and some demos from SDK 54, take a look at [this YouTube video](https://www.youtube.com/watch?v=iYh-7WfJTR0). Additionally, there will be a livestream soon where the team will walk through various features and take questions.

Join the team on a live stream about SDK 54 on September 17 at 10:00am PDT

Contents

[Precompiled React Native for iOS](#precompiled-react-native-for-ios)[iOS 26 and Liquid Glass](#ios-26-and-liquid-glass)[Support for Liquid Glass icons and Icon Composer](#support-for-liquid-glass-icons-and-icon-composer)[Using Liquid Glass views in your app](#using-liquid-glass-views-in-your-app)[Using UIKit (best choice for most Expo apps today)](#using-uikit-best-choice-for-most-expo-apps-today)[Using SwiftUI (try out our beta Expo UI library!)](#using-swiftui-try-out-our-beta-expo-ui-library)[Xcode 26 and Liquid Glass](#xcode-26-and-liquid-glass)[React Native for Android now targets Android 16 / API 36](#react-native-for-android-now-targets-android-16--api-36)[Edge-to-edge is now always enabled](#edge-to-edge-is-now-always-enabled)[Predictive back gesture available as opt-in](#predictive-back-gestureavailable-as-opt-in)[Expo Updates & EAS Update](#expo-updates--eas-update)[Improved package manager support and Expo Autolinking revamp](#improved-package-manager-support-and-expo-autolinking-revamp)[SDK 54 is the final release to include Legacy Architecture support](#sdk-54-is-the-final-release-to-include-legacy-architecture-support)[Highlights](#highlights)[Apple and Android TV](#apple-and-android-tv)[Expo CLI](#expo-cli)[Expo Router](#expo-router)[Deprecations & removals](#deprecations--removals)[Notable breaking changes](#notable-breaking-changes)[Tool version bumps](#tool-version-bumps)[Known issues](#known-issues)[➡️ Upgrading your app](#️-upgrading-your-app)[Thanks to everyone who contributed to the release!](#thanks-to-everyone-who-contributed-to-the-release)[Additional resources](#additional-resources)

