---
source: https://expo.dev/changelog/sdk-57 (expo.dev changelog page; not in a GitHub repo, fetched as HTML and converted with pandoc)
fetched: 2026-10-12
repo_sha: n/a (live page on expo.dev, fetched 2026-10-12)
---

# Expo SDK 57

JUN 30, 2026

![Brent Vatne](https://cdn.sanity.io/images/9r24npb8/production/6aa3e387c3c72e9774c61a8398bbc2f9c427270a-400x400.webp?auto=format&fit=max&q=75&w=24)Brent Vatne

![Alan Hughes](https://cdn.sanity.io/images/9r24npb8/production/fbc6f8287ef11f9f25db8039fee4ea8445dd7fe2-460x460.jpg?auto=format&fit=max&q=75&w=24)Alan Hughes

Share



Contents

Share post

[React Native 0.86](#react-native-086)[Exploring a new Expo SDK release cadence](#exploring-a-new-expo-sdk-release-cadence)[Why not include React Native 0.86 in SDK 56 if it is non-breaking?](#why-not-include-react-native-086-in-sdk-56-if-it-is-non-breaking)[Does this new cadence impact the Expo SDK maintenance window?](#does-this-new-cadence-impact-the-expo-sdk-maintenance-window)[Will there be a new Expo Go version on the App Store and Play Store?](#will-there-be-a-new-expo-go-version-on-the-app-store-and-play-store)[Other highlights](#other-highlights)[Building with Xcode 27 and the iOS 27 SDK](#building-with-xcode-27-and-the-ios-27-sdk)[Known regressions](#known-regressions)[Upgrading your app](#upgrading-your-app)





![Expo SDK 57 is released. SDK 57 includes React Native 0.86](https://cdn.sanity.io/images/9r24npb8/production/ceb71fde6e94d75f4ee4f43e63aa9c0417978952-1800x1012.png?auto=format&fit=max&q=75&w=1200)

Today we're announcing the release of Expo SDK 57. This is a small, focused release: it brings [React Native 0.86](https://reactnative.dev/blog/2026/06/11/react-native-0.86) to Expo. We intend for this to be the easiest Expo SDK upgrade you've ever made. It represents a possible shift towards [a new Expo SDK release cadence](https://expo.dev/changelog/sdk-57#exploring-a-new-expo-sdk-release-cadence) that could provide you with simple non-breaking upgrades in between more significant releases.

> **Update on August 27th**: `expo@57.0.17` updates React Native to 0.86.3, resolving the Hermes V1 memory regression from SDK 56 that could drastically increase memory usage in apps importing `react-native-worklets` or `react-native-reanimated` ([expo/expo#46519](https://github.com/expo/expo/issues/46519)), and another regression that increased startup time in development ([expo/expo#48298](https://github.com/expo/expo/issues/48298)). See the ["Known Regressions" notes](#known-regressions) for details.

## **React Native 0.86**

SDK 57 upgrades React Native from 0.85 to 0.86. The React version is unchanged from SDK 56 — both SDK 56 and SDK 57 use React 19.2. React Native 0.86 is intended to have no breaking changes from 0.85. To decide whether it's worth upgrading your app, refer to the [React Native 0.86 release notes](https://reactnative.dev/blog/2026/06/11/react-native-0.86) for the full picture.

Highlights include: [fixes and improvements to edge-to-edge support on Android](https://reactnative.dev/blog/2026/06/11/react-native-0.86#edge-to-edge-on-android), [light/dark mode emulation in React Native DevTools](https://reactnative.dev/blog/2026/06/11/react-native-0.86#react-native-devtools-improvements), and [several rendering, layout, and animation-related fixes](https://reactnative.dev/blog/2026/06/11/react-native-0.86#rendering-layout--animation).

## **Exploring a new Expo SDK release cadence**

For several years, Expo SDK has seen major releases three times per year. We found that this cadence provided a good balance between stability for app developers and freedom for our team to ship significant new features and improvements. It also helped to reduce thrash in Expo Go.

During the same period, React Native has been releasing six times per year. The React Native team prioritized shipping often in order to incrementally roll out [the New Architecture](https://reactnative.dev/architecture/landing-page), a new [React Native DevTools](https://reactnative.dev/docs/react-native-devtools) experience, [Hermes V1](https://reactnative.dev/blog/2026/02/11/react-native-0.84), and more. Each Expo SDK release would target a single React Native version, and for versions that were not targeted, developers could use [canary releases](https://docs.expo.dev/versions/latest/#canary-releases) if needed. However, now that these massive changes to React Native have shipped, the focus has shifted towards stability.

The new release model that React Native is moving towards will aim to provide a release with "no user-facing breaking changes" approximately every second release. The recently released [0.86](https://reactnative.dev/blog/2026/06/11/react-native-0.86) is the second of these non-breaking releases. At Expo, the fact that these releases are intended to be non-breaking has prompted us to revisit our release cadence. If we can provide these releases to developers almost immediately, as optional upgrades, with little effort required for the app developer beyond running `npx expo install expo@latest --fix`, then we think we should do it. So, we are exploring that approach with SDK 57.

### Why not include React Native 0.86 in SDK 56 if it is non-breaking?

This is a good question! We considered bumping from 0.85 to 0.86 in SDK 56, and ultimately decided that the set of changes between the versions was too significant for an app developer to pull in with a routine `npx expo install --fix`. [There are 601 commits touching 1,552 files between 0.85.0 and 0.86.0](https://github.com/facebook/react-native/compare/v0.85.0...v0.86.0), and we believe that the decision to pull those into your app should be intentional. Even though these commits are intended to not cause breaking changes, we think it's best to err on the side of being conservative.

Additionally, moving this bump to a new SDK version allows us on the Expo team to roll out small changes that wouldn't be appropriate to ship to an existing stable release, but that we think are genuinely useful for users. The following list includes some of those changes that are worth calling out.

### Does this new cadence impact the Expo SDK maintenance window?

SDK releases will [continue to have a lifetime of approximately one year](https://expo.fyi/outdated-sdk-versions). We may revisit the details of this policy in the future. What this means today is that Expo SDK 54 (September 2025) will receive critical fixes until the next SDK release (September or October 2026).

### Will there be a new Expo Go version on the App Store and Play Store?

We'd like to release a new version for SDK 57, but we're [still waiting on approval](https://expo.dev/changelog/expo-go-and-app-store-may-2026). Expo Go for SDK 57 is available with `eas go` for iOS devices, and through Expo CLI for Android devices/emulators and iOS simulators ([learn more](https://expo.dev/go)).

## **Other highlights**

While SDK 57 is primarily about the React Native 0.86 upgrade, a few other improvements landed alongside it:

- [**`expo-dev-client`**](https://docs.expo.dev/versions/latest/sdk/dev-client/): the iOS launcher includes a new setting to choose between auto-launching your most recent project or showing the launcher ([\#47131](https://github.com/expo/expo/pull/47131)), allowing you to override the configuration set with the config plugin.
- **`expo prebuild`**: now clears and regenerates the native **android** and **ios** directories by default; pass `--no-clean` to apply changes to the existing folders instead ([\#47209](https://github.com/expo/expo/pull/47209)).
- [**`expo-image`**](https://docs.expo.dev/versions/latest/sdk/image/): added `writeToCacheAsync` and `readFromCacheAsync` to seed and read the image cache by cache key ([\#46620](https://github.com/expo/expo/pull/46620)).
- [**`expo-router`**](https://docs.expo.dev/versions/latest/sdk/router/): `Stack.Toolbar.Badge` is now supported in header left and right placements and on toolbar menu icons on Android ([\#46537](https://github.com/expo/expo/pull/46537), [\#47276](https://github.com/expo/expo/pull/47276)).
- [**`expo-navigation-bar`**](https://docs.expo.dev/versions/latest/sdk/navigation-bar/): `setStyle` and `setHidden` now apply to React Native `<Modal>` windows on Android ([\#46491](https://github.com/expo/expo/pull/46491)).
- **Bump animation and gesture libraries**: SDK 57 bundles newer versions of [`react-native-reanimated`](https://docs.swmansion.com/react-native-reanimated/) (4.3 to 4.5), [`react-native-worklets`](https://docs.swmansion.com/react-native-worklets/) (0.8 to 0.10), and [`react-native-gesture-handler`](https://docs.swmansion.com/react-native-gesture-handler/) (2.31 to 2.32).

## **Building with Xcode 27 and the iOS 27 SDK**

Apps built with the iOS 27 SDK must use the UIKit scene-based life cycle, or they do not launch correctly on iOS 27. SDK 58 uses the scene-based life cycle by default. On SDK 57, `expo@57.0.23` adds opt-in scene support, enabled with the `ios.enableSceneSupport` property of `expo-build-properties`. See [Staying on SDK 57 with Xcode 27](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27) for the requirements and configuration.

## **Known regressions**

- **Increased memory usage with Hermes v1 is resolved in `expo@57.0.9`**: the initial SDK 57 release inherited a Hermes V1 regression from SDK 56 that could drastically increase memory usage in apps importing `react-native-worklets` or `react-native-reanimated` ([expo/expo#46519](https://github.com/expo/expo/issues/46519)). `expo@57.0.9` updates React Native to 0.86.2, which resolves this regression. Updating to `expo@57.0.9` or later is crucial for affected apps.
- [Worklets bundle mode](https://docs.swmansion.com/react-native-worklets/docs/bundleMode/) may work around the above issue in earlier releases, but it is unsupported and experimental, and may not work as expected in many cases. We currently do not recommend it for production use until it's officially supported. If you enabled it as a workaround, update to `expo@57.0.9` or later instead.
- **Increased startup time in development is resolved in `expo@57.0.17`**: a Hermes V1 regression could unintentionally increase app startup time during development ([expo/expo#48298](https://github.com/expo/expo/issues/48298)). This did not affect production apps. `expo@57.0.17` updates React Native to 0.86.3, which resolves this regression.

## **Upgrading your app**

You should expect this to be a straightforward upgrade from SDK 56 / React Native 0.85, thanks to the absence of breaking changes in React Native 0.86.

Try using our [upgrade skills](https://github.com/expo/skills/tree/main/plugins/expo/skills/upgrading-expo) ([installation instructions](https://github.com/expo/skills/tree/main?tab=readme-ov-file#claude-code)) with Claude Code, or a similar tool of your choice, to upgrade your app.

Here's how to upgrade your app to Expo SDK 57 from 56:

- **Upgrade all dependencies to match SDK 57**:

- **Check for any possible known issues with Expo Doctor**:

- **Make sure to check the [changelog](https://github.com/expo/expo/blob/main/CHANGELOG.md) for all other breaking changes!**
- **If you use [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)**:
  - Delete the **android** and **ios** directories if you generated them for a previous SDK version in your local project directory. They'll be re-generated next time you run a build, either with `npx expo run:ios`, `npx expo prebuild`, or with EAS Build.
- **If you don't use [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)**:
  - Run `npx pod-install` if you have an `ios` directory.
  - Apply any relevant changes from the [Native project upgrade helper](https://docs.expo.dev/bare/upgrade/?fromSdk=56&toSdk=57).
  - Optionally, you could consider [adopting prebuild](https://docs.expo.dev/guides/adopting-prebuild/) for easier upgrades in the future.
- **If you use [development builds with expo-dev-client](https://docs.expo.dev/develop/development-builds/introduction/)**: Create a new development build after upgrading.
- **If you use Expo Go**: consider migrating to [development builds](https://docs.expo.dev/develop/development-builds/expo-go-to-dev-build/). [Expo Go is not recommended as a development environment for production apps](https://expo.fyi/expo-go-usage).
- **Having trouble?** Refer to the [Troubleshooting your SDK upgrade](https://expo.fyi/troubleshooting-sdk-upgrades) guide.
- **Questions?** Join our weekly office hours on Wednesdays at 12:00PM Pacific [on Discord](https://chat.expo.dev/).

Contents

[React Native 0.86](#react-native-086)[Exploring a new Expo SDK release cadence](#exploring-a-new-expo-sdk-release-cadence)[Why not include React Native 0.86 in SDK 56 if it is non-breaking?](#why-not-include-react-native-086-in-sdk-56-if-it-is-non-breaking)[Does this new cadence impact the Expo SDK maintenance window?](#does-this-new-cadence-impact-the-expo-sdk-maintenance-window)[Will there be a new Expo Go version on the App Store and Play Store?](#will-there-be-a-new-expo-go-version-on-the-app-store-and-play-store)[Other highlights](#other-highlights)[Building with Xcode 27 and the iOS 27 SDK](#building-with-xcode-27-and-the-ios-27-sdk)[Known regressions](#known-regressions)[Upgrading your app](#upgrading-your-app)

