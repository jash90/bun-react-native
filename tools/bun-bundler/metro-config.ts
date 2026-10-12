// The project's Metro config exactly as Expo CLI composes it: Expo's own loadMetroConfigAsync
// (@expo/cli start/server/metro/instantiateMetro): `metro.config.js` merged over @expo/metro-config's defaults
// (loadUserConfig, EXPO_OVERRIDE_METRO_CONFIG), CLI overrides, `transformer.publicPath`, then
// withMetroMultiPlatformAsync (platforms, web polyfills, Expo's resolver chain composed into
// `resolver.resolveRequest`, virtual modules). The result feeds the Bun bundler's resolver, transform workers,
// serializer and symbolication instead of hardcoded values.
//
// Expo registers virtual modules (`\0polyfill:assets-registry`, `\0node:<module>`, ...) through
// `getMetroBundler()` (metroVirtualModules.js); a minimal stand-in bundler collects them in `virtualModules`.
import path from 'node:path';
import { createRequire } from 'node:module';

export interface ExpoMetroConfig {
  /** the composed Metro config (ConfigT) */
  config: any;
  /** contents of Expo's virtual modules by id (`\0...`) */
  virtualModules: Map<string, Buffer>;
  /** Expo's MetroTerminalReporter (`update(event)` with Metro reporter events) */
  reporter: any;
}

const cache = new Map<string, Promise<ExpoMetroConfig>>();

export function loadExpoMetroConfig(projectRoot: string, opts: { isExporting: boolean; maxWorkers?: number } = { isExporting: false }): Promise<ExpoMetroConfig> {
  const key = `${projectRoot}|${opts.isExporting}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = load(projectRoot, opts);
    cache.set(key, pending);
  }
  return pending;
}

async function load(projectRoot: string, opts: { isExporting: boolean; maxWorkers?: number }): Promise<ExpoMetroConfig> {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const { exp } = req('@expo/config').getConfig(projectRoot, { skipSDKVersionRequirement: true });
  const fileSystem: any = { getSha1: (file: string) => file };
  const depGraph = { _fileSystem: fileSystem };
  const bundler: any = {
    _depGraph: depGraph,
    getDependencyGraph: async () => depGraph,
    transformFile: async () => {
      throw new Error('Metro transformFile is not available in the Bun bundler');
    },
  };
  const { loadMetroConfigAsync } = req('@expo/cli/build/src/start/server/metro/instantiateMetro');
  const { config, reporter } = await loadMetroConfigAsync(
    projectRoot,
    { resetCache: false, maxWorkers: opts.maxWorkers },
    { exp, isExporting: opts.isExporting, getMetroBundler: () => bundler }
  );
  return {
    config,
    reporter,
    get virtualModules() {
      return (fileSystem.expoVirtualModules as Map<string, Buffer>) ?? new Map();
    },
  };
}
