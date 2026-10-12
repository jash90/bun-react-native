// bun-react-native preload (bunfig.toml: preload = ["bun-react-native/preload"]): loaded into every Bun process started
// in the app directory - Expo CLI, Metro and its workers, Jest, the Gradle/Xcode bundling steps.
//   path.preload.js         node -> Bun shim first on PATH for child processes (Gradle, CocoaPods, autolinking)
//   node-compat.preload.js  Node behaviours Metro/Expo depend on (sorted readdir, util.parseEnv order, net listen)
//   jest.preload.js         Jest under Bun behaves like under Node
//   expo-cli.preload.js     Metro on Bun for every Expo CLI command; RN_BUNDLER=bun routes bundling to the Bun bundler
require('./tools/bun/path.preload.js');
require('./tools/bun/node-compat.preload.js');
require('./tools/bun/jest.preload.js');
require('./tools/bun/expo-cli.preload.js');
