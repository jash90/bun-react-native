// expo-updates in Release builds: `app.manifest` (embedded update: asset hashes) from the Bun bundler's graph.
//
// expo-updates' build step (iOS "Generate updates resources", Android create<Variant>UpdatesResources) runs
// `expo-updates/utils/build/createUpdatesResources.js`, which takes the assets from Expo CLI's
// createMetroServerAndBundleRequestAsync + exportEmbedAssetsAsync (`@expo/cli/build/src/expoUpdatesExports`): a Metro
// server and a walk of Metro's graph. With the Bun bundler the embedded bundle and its assets come from Bun, so the
// manifest is computed from the same graph (tools/bun/expo-cli.preload.js installs this for that script): the assets
// of a Bun bundle of the same entry, platform and mode, in Metro's AssetData shape. Projects bundled with Metro
// (./metro-config-support.ts, RN_BUNDLER=metro) keep Expo's functions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bundle } from './bundle';
import { patchExpoCliModule } from './expo-helpers';
import { usesMetroEngine } from './metro-config-support';

export function installBunUpdatesResources(projectRoot: string) {
  if (usesMetroEngine(projectRoot, 'expo-updates resources')) return;
  patchExpoCliModule(projectRoot, 'expoUpdatesExports', {
    // no Metro server: the "bundle request" is the options it would have been made from
    createMetroServerAndBundleRequestAsync: async (_root: string, options: any) => ({ server: { end() {} }, bundleRequest: options }),
    exportEmbedAssetsAsync: async (_server: unknown, options: any, projectRootArg: string) => {
      // real path, like ./cli.ts: module paths from the resolver are real paths (/tmp -> /private/tmp on macOS)
      const root = fs.realpathSync(projectRootArg);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-rn-updates-'));
      try {
        const result = await bundle({
          projectRoot: root,
          entryFile: path.resolve(root, options.entryFile),
          platform: options.platform,
          dev: !!options.dev,
          minify: !!options.minify,
          bundleOutput: path.join(tmp, 'index.bundle'),
        });
        return result.assets;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  });
}
