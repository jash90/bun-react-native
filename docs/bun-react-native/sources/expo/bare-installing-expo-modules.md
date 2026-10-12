---
source: https://docs.expo.dev/bare/installing-expo-modules/ (GitHub: https://github.com/expo/expo/blob/fe4a2c8e7875d56283ab314a9b4a0da6b6df159d/docs/pages/bare/installing-expo-modules.mdx)
fetched: 2026-10-12
repo_sha: fe4a2c8e7875d56283ab314a9b4a0da6b6df159d
---

---
title: Install Expo modules in an existing React Native project
sidebar_title: Install Expo modules
description: Learn how to prepare your existing React Native project to install and use any Expo module.
---

To use Expo modules in your app, you will need to install and configure the `expo` package.

The `expo` package has a small footprint; it includes only a minimal set of packages that are needed in nearly every app and the module and autolinking infrastructure that other Expo SDK packages are built with. Once the `expo` package is installed and configured in your project, you can use `npx expo install` to add any other Expo module from the SDK.

Depending on how you [initialized the project](/bare/overview/), there are two ways you can install the Expo modules: [automatically](#automatic-installation) or [manually](#manual-installation).

## Automatic installation

To install and use Expo modules, the easiest way to get up and running is with the `install-expo-modules` command.

<InstallSection
  packageName="expo"
  cmd={[
    '# Install and configure the expo package automatically',
    '$ npx install-expo-modules@latest',
  ]}
  hideBareInstructions
/>

- <YesIcon small /> **When the command succeeds**, you will be able to add any Expo module in your
  app! Proceed to [Usage](#usage) for more information.

- <NoIcon small /> **If the command fails**, follow the manual installation instructions. Updating
  code programmatically can be tricky, and if your project deviates significantly from a default
  React Native project, then you need to perform manual installation and adapt the instructions here
  to your codebase.

## Manual installation

The following instructions apply to installing the latest version of Expo modules in React Native 0.86. For previous versions, check the [native upgrade helper](/bare/upgrade) to see how these files are customized.

<InstallSection packageName="expo" cmd={['$ npm install expo']} hideBareInstructions />

Once installation is complete, apply the changes from the following diffs to configure Expo modules in your project. This is expected to take about five minutes, and you may need to adapt it slightly depending on how customized your project is.

### Configuration for Android

<!-- DiffBlock inlined from docs/public/static/diffs/expo-android.diff -->
```diff
diff --git a/android/app/src/main/java/com/myapp/MainActivity.kt b/android/app/src/main/java/com/myapp/MainActivity.kt
index 1789e54..b6ac31d 100644
--- a/android/app/src/main/java/com/myapp/MainActivity.kt
+++ b/android/app/src/main/java/com/myapp/MainActivity.kt
@@ -1,4 +1,5 @@
 package com.myapp
+import expo.modules.ReactActivityDelegateWrapper

 import com.facebook.react.ReactActivity
 import com.facebook.react.ReactActivityDelegate
@@ -18,5 +19,5 @@ class MainActivity : ReactActivity() {
    * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
    */
   override fun createReactActivityDelegate(): ReactActivityDelegate =
-      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
+      ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled))
 }
diff --git a/android/app/src/main/java/com/myapp/MainApplication.kt b/android/app/src/main/java/com/myapp/MainApplication.kt
index 9cb435b..bd46af6 100644
--- a/android/app/src/main/java/com/myapp/MainApplication.kt
+++ b/android/app/src/main/java/com/myapp/MainApplication.kt
@@ -1,4 +1,7 @@
 package com.myapp
+import android.content.res.Configuration
+import expo.modules.ApplicationLifecycleDispatcher
+import expo.modules.ExpoReactHostFactory

 import android.app.Application
 import com.facebook.react.PackageList
@@ -10,7 +13,7 @@ import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
 class MainApplication : Application(), ReactApplication {

   override val reactHost: ReactHost by lazy {
-    getDefaultReactHost(
+    ExpoReactHostFactory.getDefaultReactHost(
       context = applicationContext,
       packageList =
         PackageList(this).packages.apply {
@@ -23,5 +26,11 @@ class MainApplication : Application(), ReactApplication {
   override fun onCreate() {
     super.onCreate()
     loadReactNative(this)
+    ApplicationLifecycleDispatcher.onApplicationCreate(this)
+  }
+
+  override fun onConfigurationChanged(newConfig: Configuration) {
+    super.onConfigurationChanged(newConfig)
+    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
   }
 }
diff --git a/android/settings.gradle b/android/settings.gradle
index 8762b63..1e69c41 100644
--- a/android/settings.gradle
+++ b/android/settings.gradle
@@ -1,6 +1,20 @@
-pluginManagement { includeBuild("../node_modules/@react-native/gradle-plugin") }
-plugins { id("com.facebook.react.settings") }
-extensions.configure(com.facebook.react.ReactSettingsExtension){ ex -> ex.autolinkLibrariesFromCommand() }
+pluginManagement { includeBuild("../node_modules/@react-native/gradle-plugin")
+  def expoPluginsPath = new File(
+    providers.exec {
+      workingDir(rootDir)
+      commandLine("node", "--print", "require.resolve('expo-modules-autolinking/package.json', { paths: [require.resolve('expo/package.json')] })")
+    }.standardOutput.asText.get().trim(),
+    "../android/expo-gradle-plugin"
+  ).absolutePath
+  includeBuild(expoPluginsPath)
+}
+plugins { id("com.facebook.react.settings")
+id("expo-autolinking-settings")
+}
+extensions.configure(com.facebook.react.ReactSettingsExtension){ ex -> ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand) }
 rootProject.name = 'myapp'
 include ':app'
 includeBuild('../node_modules/@react-native/gradle-plugin')
+expoAutolinking.useExpoModules()
+expoAutolinking.useExpoVersionCatalog()
+includeBuild(expoAutolinking.reactNativeGradlePlugin)
diff --git a/android/build.gradle b/android/build.gradle
index dad99b0..d7e8f5a 100644
--- a/android/build.gradle
+++ b/android/build.gradle
@@ -19,3 +19,4 @@ buildscript {
 }

 apply plugin: "com.facebook.react.rootproject"
+apply plugin: "expo-root-project"
```

### Configuration for iOS

<!-- DiffBlock inlined from docs/public/static/diffs/expo-ios.diff -->
```diff
diff --git a/ios/Podfile b/ios/Podfile
index c41f442..6ec9f2c 100644
--- a/ios/Podfile
+++ b/ios/Podfile
@@ -1,3 +1,4 @@
+require File.join(File.dirname(`node --print "require.resolve('expo/package.json')"`), "scripts/autolinking")
 # Resolve react_native_pods.rb with node to allow for hoisting
 require Pod::Executable.execute_command('node', ['-p',
   'require.resolve(
@@ -5,7 +6,7 @@ require Pod::Executable.execute_command('node', ['-p',
     {paths: [process.argv[1]]},
   )', __dir__]).strip

-platform :ios, min_ios_version_supported
+platform :ios, '16.4'
 prepare_react_native_project!

 linkage = ENV['USE_FRAMEWORKS']
@@ -15,7 +16,24 @@ if linkage != nil
 end

 target 'myapp' do
-  config = use_native_modules!
+  use_expo_modules!
+
+  if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] == '1'
+    config_command = ['node', '-e', "process.argv=['', '', 'config'];require('@react-native-community/cli').run()"];
+  else
+    config_command = [
+      'node',
+      '--no-warnings',
+      '--eval',
+      'require(require.resolve(\'expo-modules-autolinking\', { paths: [require.resolve(\'expo/package.json\')] }))(process.argv.slice(1))',
+      'react-native-config',
+      '--json',
+      '--platform',
+      'ios'
+    ]
+  end
+
+  config = use_native_modules!(config_command)

   use_react_native!(
     :path => config[:reactNativePath],
diff --git a/ios/myapp/AppDelegate.swift b/ios/myapp/AppDelegate.swift
index d06a6a8..d8dd308 100644
--- a/ios/myapp/AppDelegate.swift
+++ b/ios/myapp/AppDelegate.swift
@@ -1,21 +1,22 @@
 import UIKit
+internal import Expo
 import React
 import React_RCTAppDelegate
 import ReactAppDependencyProvider

 @main
-class AppDelegate: UIResponder, UIApplicationDelegate {
+class AppDelegate: ExpoAppDelegate {
   var window: UIWindow?

   var reactNativeDelegate: ReactNativeDelegate?
   var reactNativeFactory: RCTReactNativeFactory?

-  func application(
+  override func application(
     _ application: UIApplication,
     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
   ) -> Bool {
     let delegate = ReactNativeDelegate()
-    let factory = RCTReactNativeFactory(delegate: delegate)
+    let factory = ExpoReactNativeFactory(delegate: delegate)
     delegate.dependencyProvider = RCTAppDependencyProvider()

     reactNativeDelegate = delegate
@@ -29,13 +30,14 @@ class AppDelegate: UIResponder, UIApplicationDelegate {
       launchOptions: launchOptions
     )

-    return true
+    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
   }
 }

-class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
+class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
   override func sourceURL(for bridge: RCTBridge) -> URL? {
-    self.bundleURL()
+    // needed to return the correct URL for expo-dev-client.
+    bridge.bundleURL ?? bundleURL()
   }

   override func bundleURL() -> URL? {
```

Optionally, you can also add additional delegate methods to your **AppDelegate.swift**. Some libraries may require them, so unless you have a good reason to leave them out, it is recommended to add them. [See delegate methods in AppDelegate.swift](https://github.com/expo/expo/blob/sdk-57/templates/expo-template-bare-minimum/ios/HelloWorld/AppDelegate.swift#L34-L51).

Save all of your changes and update your iOS Deployment Target in Xcode to <code>iOS 16.4</code>:

- Open **your-project-name.xcworkspace** in Xcode, select your project in the left sidebar.
- Select **Targets** > **your-project-name** > **Build Settings** > **iOS Deployment Target** and ensure it is set to <code>iOS 16.4</code>.

The last step is to install the project's CocoaPods again to pull in Expo modules that are detected by `use_expo_modules!` directive that we added to the **Podfile**:

<InstallSection
  packageName="expo"
  cmd={[
    '# Install pods',
    '$ npx pod-install',
    '',
    '# Alternatively, the run command will install them for you',
    '$ npx expo run:ios',
  ]}
  hideBareInstructions
/>

### Configure Expo CLI for bundling on Android and iOS

We recommend using Expo CLI and related tooling configurations to bundle your app JavaScript code and assets. This adds support for using the `"main"` field in **package.json** to use [Expo Router](/router/introduction/) library. Not using Expo CLI for bundling may result in unexpected behavior. [Learn more about Expo CLI](/bare/using-expo-cli/).

<Collapsible summary="Use babel-preset-expo in your babel.config.js">
  <!-- DiffBlock inlined from docs/public/static/diffs/babel-config.diff -->
```diff
diff --git a/babel.config.js b/babel.config.js
index f7b3da3..fcb3486 100644
--- a/babel.config.js
+++ b/babel.config.js
@@ -1,3 +1,3 @@
 module.exports = {
-  presets: ['module:@react-native/babel-preset'],
+  presets: ['babel-preset-expo'],
 };
```
</Collapsible>

<Collapsible summary="Extend expo/metro-config in your metro.config.js">
  <!-- DiffBlock inlined from docs/public/static/diffs/metro-config.diff -->
```diff
diff --git a/metro.config.js b/metro.config.js
index ad8f87b..0dfff20 100644
--- a/metro.config.js
+++ b/metro.config.js
@@ -1,4 +1,5 @@
-const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
+const { getDefaultConfig } = require('expo/metro-config');
+const { mergeConfig } = require('@react-native/metro-config');

 /**
  * Metro configuration
```
</Collapsible>

<Collapsible summary="Configure Android project to bundle with Expo CLI">
  <!-- DiffBlock inlined from docs/public/static/diffs/expo-cli-android.diff -->
```diff
diff --git a/android/app/build.gradle b/android/app/build.gradle
index e441fee..6091cd1 100644
--- a/android/app/build.gradle
+++ b/android/app/build.gradle
@@ -52,6 +52,11 @@ react {

     /* Autolinking */
     autolinkLibrariesWithApp()
+    //
+    // Added by install-expo-modules
+    entryFile = file(["node", "-e", "require('expo/scripts/resolveAppEntry')", rootDir.getAbsoluteFile().getParentFile().getAbsolutePath(), "android", "absolute"].execute(null, rootDir).text.trim())
+    cliFile = new File(["node", "--print", "require.resolve('@expo/cli')"].execute(null, rootDir).text.trim())
+    bundleCommand = "export:embed"
 }

 /**
```
</Collapsible>

<Collapsible summary="Configure iOS project to bundle with Expo CLI">

Replace the shell script under **Build Phases** > **Bundle React Native code and images** in Xcode with the following:

```sh /bin/sh
if [[ -f "$PODS_ROOT/../.xcode.env" ]]; then
  source "$PODS_ROOT/../.xcode.env"
fi
if [[ -f "$PODS_ROOT/../.xcode.env.local" ]]; then
  source "$PODS_ROOT/../.xcode.env.local"
fi

# The project root by default is one level up from the ios directory
export PROJECT_ROOT="$PROJECT_DIR"/..

if [[ "$CONFIGURATION" = *Debug* ]]; then
  export SKIP_BUNDLING=1
fi
if [[ -z "$ENTRY_FILE" ]]; then
  # Set the entry JS file using the bundler's entry resolution.
  export ENTRY_FILE="$("$NODE_BINARY" -e "require('expo/scripts/resolveAppEntry')" "$PROJECT_ROOT" ios relative | tail -n 1)"
fi

if [[ -z "$CLI_PATH" ]]; then
  # Use Expo CLI
  export CLI_PATH="$("$NODE_BINARY" --print "require.resolve('@expo/cli')")"
fi
if [[ -z "$BUNDLE_COMMAND" ]]; then
  # Default Expo CLI command for bundling
  export BUNDLE_COMMAND="export:embed"
fi

`"$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'"`
```

And add support the `"main"` field in **package.json** by making the following change to **AppDelegate.swift**:

<DiffBlock
  raw={`diff --git a/ios/AppDelegate.swift b/ios/AppDelegate.swift
index 0000000..1111111 100644
--- a/ios/AppDelegate.swift
+++ b/ios/AppDelegate.swift
@@ -1,7 +1,7 @@
   override func bundleURL() -> URL? {
 #if DEBUG
-    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
+    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
 #else
     Bundle.main.url(forResource: "main", withExtension: "jsbundle")
 #endif
   }`}
/>

</Collapsible>

## Usage

### Verifying installation

You can verify that the installation was successful by logging a value from [`expo-constants`](/versions/latest/sdk/constants).

- Run `npx expo install expo-constants`
- Then, run `npx expo run` and modify your app JavaScript code to add the following:

```tsx
import Constants from 'expo-constants';
console.log(Constants.systemFonts);
```

### Using Expo SDK packages

Once the `expo` package is installed and configured in your project, you can use `npx expo install` to add any other Expo module from the SDK. See [Using Libraries](/workflow/using-libraries) for more information.

### Expo modules included in the `expo` package

The following Expo modules are brought in as dependencies of the `expo` package:

- [`expo-asset`](/versions/latest/sdk/asset) - A JavaScript-only package that builds around `expo-file-system` and provides a common foundation for assets across all Expo modules.
- [`expo-constants`](/versions/latest/sdk/constants) - Provides access to the manifest.
- [`expo-file-system`](/versions/latest/sdk/filesystem) - Interact with the device file system. Used by `expo-asset` and many other Expo modules. Commonly used directly by developers in application code.
- [`expo-font`](/versions/latest/sdk/font) - Load fonts at runtime. This module is optional and can be safely removed. However, it is recommended if you use `expo-dev-client` for development and it is required by `@expo/vector-icons`.
- [`expo-keep-awake`](/versions/latest/sdk/keep-awake) - Prevents your device from going to sleep while developing your app. This module is optional and can be safely removed.

To exclude any of these modules, refer to the following guide on [excluding modules from autolinking](#excluding-specific-modules-from-autolinking).

### Excluding specific modules from autolinking

If you need to exclude native code from Expo modules you are not using, but were installed by other dependencies, you can use the [`expo.autolinking.exclude`](/modules/autolinking/#exclude) property in **package.json**:

```json package.json
{
  "name": "...",
  "dependencies": {},
  "expo": {
    "autolinking": {
      "exclude": ["expo-keep-awake"]
    }
  }
}
```
