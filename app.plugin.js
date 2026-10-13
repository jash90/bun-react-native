// bun-react-native config plugin (app.json: "plugins": ["bun-react-native"]): Xcode script phases (bundling, codegen,
// expo-constants) run on Bun. Bundling itself needs no native change: the Xcode and Gradle bundle steps run Expo CLI
// from the app directory, where bunfig.toml's preload routes it (Metro on Bun by default, RN_BUNDLER=bun for the Bun
// bundler). Gradle runs `node` from PATH - start Android builds with `bun expo run:android` (the preload puts the
// node -> Bun shim first on PATH) or put the shim on PATH (`bunx bun-react-native doctor`).
module.exports = require('./plugins/with-bun-xcode-env');
