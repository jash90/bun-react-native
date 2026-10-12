// Expo config plugin: make Xcode build phases use Bun as NODE_BINARY (part of bun-react-native's app.plugin.js).
//
// Xcode script phases (bundling, codegen, expo-constants) run "$NODE_BINARY" from ios/.xcode.env(.local).
// `prebuild --clean` regenerates ios/, so the change has to live in a plugin to survive CNG. Xcode started from the
// Dock does not get the shell's PATH, so the Bun that ran prebuild is the fallback.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const fallback = process.versions.bun ? process.execPath : path.join(require('os').homedir(), '.bun', 'bin', 'bun');
const LINE = `export NODE_BINARY=$(command -v bun || echo "${fallback}")`;

module.exports = function withBunXcodeEnv(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, '.xcode.env');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const next = current.includes(LINE)
        ? current
        : current.replace(/^export NODE_BINARY=.*$/m, '').trimEnd() + `\n${LINE}\n`;
      fs.writeFileSync(file, next);
      return cfg;
    },
  ]);
};
