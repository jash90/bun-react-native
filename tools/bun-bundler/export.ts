// `expo export` on the Bun bundler: the same output layout as Expo CLI, so EAS Update (`eas update --skip-bundler`),
// EAS Hosting and expo-server consume it unchanged.
//
//   native (ios/android) - _expo/static/js/<platform>/<entry>-<md5>.hbc (Hermes bytecode; .js without Hermes or
//                          with --no-bytecode), assets/<md5> for every asset file, metadata.json (EAS Update),
//                          assetmap.json with --dump-assetmap
//   web                  - ./web-export.ts (single / static / server output)
//
// Bundles come from the Bun bundler (./bundle.ts, ./web.ts); asset filtering (`updates.assetPatternsToBeBundled`),
// metadata, favicon, public folder and file writing are Expo CLI's functions (./expo-helpers.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bundle } from './bundle';
import { exportDomComponents } from './dom';
import { expoHelpers, type ExportFiles } from './expo-helpers';
import { getBaseUrl, getExpoConfig } from './shared';
import { md5 } from './web';
import { exportWebAsync } from './web-export';

export type ExportPlatform = 'ios' | 'android' | 'web' | 'tvos' | 'macos';

export interface ExportOptions {
  projectRoot: string;
  outputDir: string;
  platforms: ExportPlatform[];
  dev: boolean;
  minify: boolean;
  bytecode: boolean;
  sourceMaps: boolean;
  dumpAssetmap: boolean;
  skipSSG: boolean;
  log: (msg: string) => void;
}

/** One native bundle for EAS Update: Bun bundle -> Hermes bytecode (Expo's buildHermesBundleAsync). */
async function exportNativeBundle(opts: ExportOptions, platform: Exclude<ExportPlatform, 'web'>, files: ExportFiles, exp: any) {
  const { projectRoot } = opts;
  const h = expoHelpers(projectRoot);
  const entry = h.resolveRelativeEntryPoint(projectRoot, { platform });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-rn-export-'));
  try {
    const jsFile = path.join(tmp, 'index.js');
    const mapFile = opts.sourceMaps ? path.join(tmp, 'index.js.map') : undefined;
    const result = await bundle({
      projectRoot,
      entryFile: entry,
      platform,
      dev: opts.dev,
      minify: opts.minify,
      bundleOutput: jsFile,
      sourcemapOutput: mapFile,
      log: opts.log,
    });
    let code = fs.readFileSync(jsFile, 'utf8');
    // DOM components: content-addressed web bundles; the proxy's `<md5(url)>.html` points at the html's md5
    const dom = await exportDomComponents({ projectRoot, references: result.domComponents, dev: opts.dev, md5Filenames: true, files });
    for (const d of dom) if (d.replace) code = code.split(d.replace[0]).join(d.replace[1]);
    const map = mapFile ? fs.readFileSync(mapFile, 'utf8') : null;
    const base = `_expo/static/js/${platform}/${path.basename(entry).replace(/\.\w+$/, '')}-${md5(code)}`;
    // Expo compiles bytecode for production Hermes exports only (MetroBundlerDevServer isHermesEnabled: !dev)
    const hermes = opts.bytecode && !opts.dev && h.isEnableHermesManaged(exp, platform);
    let fileName: string;
    if (hermes) {
      const out = await h.buildHermesBundleAsync({ projectRoot, filename: entry, code, map, minify: true });
      fileName = `${base}.hbc`;
      files.set(fileName, { contents: out.hbc, originFilename: entry });
      if (map && out.sourcemap) files.set(`${fileName}.map`, { contents: out.sourcemap, originFilename: entry });
    } else {
      fileName = `${base}.js`;
      files.set(fileName, { contents: map ? `${code}\n//# sourceMappingURL=${path.basename(fileName)}.map` : code, originFilename: entry });
      if (map) files.set(`${fileName}.map`, { contents: map, originFilename: entry });
    }
    opts.log(`${{ ios: 'iOS', android: 'Android', tvos: 'tvOS', macos: 'macOS' }[platform]} Bundled with Bun (${result.modules.length} files) -> ${fileName}`);
    return { fileName, assets: result.assets, domMetadata: dom.flatMap((d) => d.metadata) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function exportAppAsync(opts: ExportOptions) {
  const t0 = performance.now();
  const { projectRoot } = opts;
  const h = expoHelpers(projectRoot);
  // like Expo CLI: force the environment, load .env files for EXPO_PUBLIC_* inlining
  const nodeEnv = h.req('@expo/cli/build/src/utils/nodeEnv');
  process.env.NODE_ENV = opts.dev ? 'development' : 'production';
  nodeEnv.setNodeEnv(process.env.NODE_ENV);
  nodeEnv.loadEnvFiles(projectRoot);
  const exp = getExpoConfig(projectRoot);
  if (exp.experiments?.reactServerComponentRoutes || exp.experiments?.reactServerFunctions) {
    throw new Error('React Server Components are not supported by the Bun bundler (use `bun run export:metro`)');
  }
  const baseUrl = getBaseUrl(projectRoot, exp);
  const outputDir = path.resolve(projectRoot, opts.outputDir);
  fs.rmSync(outputDir, { recursive: true, force: true });
  const files: ExportFiles = new Map();
  await h.copyPublicFolderAsync(h.getPublicFolderPath(projectRoot), outputDir);

  const native = opts.platforms.filter((p): p is Exclude<ExportPlatform, 'web'> => p !== 'web');
  // Expo writes metadata.json whenever a platform is bundled as a single bundle ("SPA platforms": native, and
  // web with `web.output: single`); web entries are left out of it
  const spaWeb = opts.platforms.includes('web') && !['static', 'server'].includes(exp.web?.output ?? '');
  if (native.length || spaWeb) {
    const bundles: Record<string, { assets: any[] }> = {};
    const fileNames: Record<string, string[]> = {};
    const domComponentAssetsMetadata: Record<string, { path: string; ext: string }[]> = {};
    // sequential: each bundle uses the whole worker pool
    for (const platform of native) {
      const r = await exportNativeBundle(opts, platform, files, exp);
      bundles[platform] = { assets: r.assets };
      fileNames[platform] = [r.fileName];
      if (r.domMetadata.length) domComponentAssetsMetadata[platform] = r.domMetadata;
    }
    const { assets, embeddedHashSet } = await h.exportAssetsAsync(projectRoot, { files, exp, outputDir, bundles, baseUrl });
    if (opts.dumpAssetmap) files.set('assetmap.json', { contents: JSON.stringify(h.createAssetMap({ assets })) });
    files.set('metadata.json', { contents: JSON.stringify(h.createMetadataJson({ bundles, fileNames, embeddedHashSet, domComponentAssetsMetadata })) });
  }

  let web: Awaited<ReturnType<typeof exportWebAsync>> | null = null;
  if (opts.platforms.includes('web')) {
    web = await exportWebAsync({
      projectRoot,
      outputDir,
      files,
      exp,
      baseUrl,
      dev: opts.dev,
      minify: opts.minify,
      sourceMaps: opts.sourceMaps,
      skipSSG: opts.skipSSG,
      log: opts.log,
    });
  }

  await h.persistMetroFilesAsync(files, outputDir);
  const ms = Math.round(performance.now() - t0);
  const parts = [native.length ? `${native.join(', ')} (EAS Update metadata.json)` : '', web ? `web (${web.output}, ${web.routes} HTML routes)` : ''].filter(Boolean);
  opts.log(`Exported ${parts.join(' + ')} in ${ms}ms with Bun -> ${outputDir}`);
  return { files: files.size, web, ms };
}
