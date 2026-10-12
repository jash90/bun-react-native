// Expo CLI functions the Bun bundler reuses as-is (they do not run Metro): route manifests, HTML serialization,
// favicon generation, public folder, file persistence, EAS Update metadata, Hermes bytecode, error overlays.
// Reusing them keeps the output of `bun-bundler export` identical in shape to `expo export`.
import path from 'node:path';
import { createRequire } from 'node:module';

export function expoHelpers(projectRoot: string) {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const cli = (m: string) => req(`@expo/cli/build/src/${m}`);
  return {
    req,
    /** any `@expo/cli/build/src/<module>` */
    cli,
    // export
    getFilesToExportFromServerAsync: cli('export/exportStaticAsync').getFilesToExportFromServerAsync,
    getHtmlFiles: cli('export/exportStaticAsync').getHtmlFiles,
    generateFaviconAssetAsync: cli('export/favicon').generateFaviconAssetAsync,
    getPublicFolderPath: cli('export/publicFolder').getPublicFolderPath,
    copyPublicFolderAsync: cli('export/publicFolder').copyPublicFolderAsync,
    persistMetroFilesAsync: cli('export/saveAssets').persistMetroFilesAsync,
    getFilesFromSerialAssets: cli('export/saveAssets').getFilesFromSerialAssets,
    persistMetroAssetsAsync: cli('export/persistMetroAssets').persistMetroAssetsAsync,
    exportAssetsAsync: cli('export/exportAssets').exportAssetsAsync,
    createMetadataJson: cli('export/createMetadataJson').createMetadataJson,
    createAssetMap: cli('export/writeContents').createAssetMap,
    isEnableHermesManaged: cli('export/exportHermes').isEnableHermesManaged,
    // server / HTML
    serializeHtmlWithAssets: cli('start/server/metro/serializeHtml').serializeHtmlWithAssets,
    createTemplateHtmlFromExpoConfigAsync: cli('start/server/webTemplate').createTemplateHtmlFromExpoConfigAsync,
    fetchManifest: cli('start/server/metro/fetchRouterManifest').fetchManifest,
    inflateManifest: cli('start/server/metro/fetchRouterManifest').inflateManifest,
    // server data loaders
    fromRuntimeManifestRoute: cli('start/server/metro/resolveLoader').fromRuntimeManifestRoute,
    fromServerManifestRoute: cli('start/server/metro/resolveLoader').fromServerManifestRoute,
    getContextKey: req('expo-router/build/matchers').getContextKey as (contextKey: string) => string,
    resolveLoaderContextKey: req('expo-server/private').resolveLoaderContextKey as (key: string, params: any) => string,
    getErrorOverlayHtmlAsync: cli('start/server/metro/metroErrorInterface').getErrorOverlayHtmlAsync,
    createFaviconAsString: req('@expo/router-server/build/utils/html').createFaviconAsString,
    // native
    resolveRelativeEntryPoint: req('@expo/config/paths').resolveRelativeEntryPoint,
    buildHermesBundleAsync: req('@expo/metro-config/build/serializer/exportHermes').buildHermesBundleAsync,
  };
}

export type ExpoHelpers = ReturnType<typeof expoHelpers>;

/** Expo's `files` map: output path -> contents (+ where it goes and how it is logged). */
export type ExportFiles = Map<
  string,
  {
    contents: string | Uint8Array;
    targetDomain?: 'client' | 'server';
    originFilename?: string;
    routeId?: string;
    apiRouteId?: string;
    middlewareId?: string;
    loaderId?: string;
    assetId?: string;
  }
>;

/**
 * Replace exports of an Expo CLI module (`@expo/cli/build/src/<module>`) for every later `require` of it; its other
 * exports stay Expo's. Expo CLI's commands then run unchanged with the Bun bundler behind them.
 */
export function patchExpoCliModule(projectRoot: string, module: string, overrides: Record<string, (...args: any[]) => any>) {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const target = req.resolve(`@expo/cli/build/src/${module}`);
  const original = req(target);
  if (original.__bunBundler) return;
  const patched: any = {};
  for (const key of Object.keys(original)) Object.defineProperty(patched, key, { enumerable: true, configurable: true, get: () => original[key] });
  Object.defineProperty(patched, '__esModule', { value: true });
  Object.defineProperty(patched, '__bunBundler', { value: true });
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(patched, key, { enumerable: true, value });
  (req.cache as any)[target].exports = patched;
}

/**
 * React Server Components / server functions (beta in Expo): Expo's implementation is bound to Metro's runtime and
 * module ids, so these projects keep Metro as the bundler (still on the Bun runtime).
 */
export function usesReactServerComponents(exp: any): boolean {
  return !!(exp?.experiments?.reactServerFunctions || exp?.experiments?.reactServerComponentRoutes);
}
