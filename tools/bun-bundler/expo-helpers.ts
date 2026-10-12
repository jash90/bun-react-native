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
    assetId?: string;
  }
>;
