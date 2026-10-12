// Expo config plugin: native release builds bundle JavaScript with the Bun bundler
// (tools/bun-bundler/cli.ts) instead of Metro (`@expo/cli export:embed`).
// app.json -> "plugins": ["./plugins/with-bun-bundler"]
//
// iOS: the "Bundle React Native code and images" phase runs "$NODE_BINARY" "$CLI_PATH" "$BUNDLE_COMMAND" ...
//      and only computes CLI_PATH when it is unset -> export it from ios/.xcode.env.
// Android: the React Native Gradle Plugin runs <nodeExecutableAndArgs> <cliFile> <bundleCommand> ...
//      -> point `cliFile` at the Bun bundler CLI.
// Escape hatch at build time: RN_BUNDLER=metro (the CLI then delegates to `@expo/cli export:embed`).
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const CLI = 'tools/bun-bundler/cli.ts';
const XCODE_LINE = `export CLI_PATH="$PROJECT_DIR/../${CLI}"`;

function withBunBundlerIos(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, '.xcode.env');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!current.includes(XCODE_LINE)) {
        fs.writeFileSync(file, current.replace(/^export CLI_PATH=.*\n?/m, '').trimEnd() + `\n${XCODE_LINE}\n`);
      }
      return cfg;
    },
  ]);
}

function withBunBundlerAndroid(config) {
  return withAppBuildGradle(config, (cfg) => {
    const line = `    cliFile = new File(rootDir, "../${CLI}")`;
    const re = /^\s*cliFile = .*$/m;
    if (!re.test(cfg.modResults.contents)) {
      throw new Error('with-bun-bundler: could not find `cliFile = ...` in android/app/build.gradle');
    }
    cfg.modResults.contents = cfg.modResults.contents.replace(re, line);
    return cfg;
  });
}

module.exports = function withBunBundler(config) {
  return withBunBundlerAndroid(withBunBundlerIos(config));
};
