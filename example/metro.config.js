// Plain Expo config: bun-react-native needs nothing here - its preload runs Metro on Bun (Node-compat transform
// workers, Bun's minifier) for every config Expo CLI composes.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
