// `export:embed` (what Xcode / Gradle run for release builds) = Expo CLI's own `expo export:embed` command with
// Expo's `export/embed/exportEmbedAsync` module re-pointed at the Bun bundler (installBunExportEmbed). Expo keeps
// its argument parsing, help, defaults and validation (resolveOptions), `.env` loading, the CI cache rule and the
// eager-bundle reconciliation; the bundle, map, assets, Hermes bytecode (`--bytecode`), standalone server export
// (`web.output: "server"`) and DOM components come from Bun.
//
// The same patch is installed in Expo CLI processes by tools/bun/expo-cli.preload.js, so the eager pre-bundle of
// `expo run:ios --configuration Release` / `expo run:android --variant release` (exportEagerAsync ->
// exportEmbedInternalAsync) is made by Bun too, and the native build script then copies it (matching option key).
import fs from 'node:fs';
import path from 'node:path';

import { bundle } from './bundle';
import { expoHelpers, patchExpoCliModule } from './expo-helpers';
import { usesMetroEngine } from './metro-config-support';
import { createProject, getRouterRoot } from './shared';
import { appendDebugId } from './sourcemap';

type NativePlatform = 'ios' | 'android' | 'tvos' | 'macos';
const LABEL: Record<NativePlatform, string> = { ios: 'iOS', android: 'Android', tvos: 'tvOS', macos: 'macOS' };
const isApple = (p: string) => p === 'ios' || p === 'tvos' || p === 'macos';

/** Expo's resolved export:embed options (export/embed/resolveOptions) */
interface EmbedOptions {
  entryFile: string;
  platform: NativePlatform;
  dev: boolean;
  minify: boolean;
  bundleOutput: string;
  bundleEncoding?: BufferEncoding;
  maxWorkers?: number;
  sourcemapOutput?: string;
  sourcemapSourcesRoot?: string;
  sourcemapUseAbsolutePath?: boolean;
  assetsDest?: string;
  assetCatalogDest?: string;
  unstableTransformProfile?: string;
  resetCache?: boolean;
  bytecode?: boolean;
  eager?: boolean;
  skipServer?: boolean;
}

/** Re-point Expo's export:embed module at the Bun bundler (its other exports, used by expo-updates, stay Metro's). */
export function installBunExportEmbed(projectRoot: string) {
  if (usesMetroEngine(projectRoot, 'export:embed')) return;
  patchExpoCliModule(projectRoot, 'export/embed/exportEmbedAsync', { exportEmbedAsync, exportEmbedInternalAsync });
}

/** Expo's exportEmbedAsync with the Bun bundler. */
export async function exportEmbedAsync(projectRoot: string, options: EmbedOptions) {
  const cli = expoHelpers(projectRoot).cli;
  const { env } = cli('utils/env');
  // The React Native build scripts always reset the cache; Expo skips that on CI
  if (env.CI && options.resetCache) options.resetCache = false;
  const nodeEnv = cli('utils/nodeEnv');
  const mode = options.dev ? 'development' : 'production';
  nodeEnv.setNodeEnv(mode);
  nodeEnv.loadEnvFiles(projectRoot, { mode }); // SDK 58 takes the mode, SDK 57 reads NODE_ENV

  // `expo run` bundled eagerly before the native build: reuse it when the options match (Expo's key)
  const { deserializeEagerKey, getExportEmbedOptionsKey } = cli('export/embed/resolveOptions');
  const eager = env.__EXPO_EAGER_BUNDLE_OPTIONS ? deserializeEagerKey(env.__EXPO_EAGER_BUNDLE_OPTIONS) : null;
  if (eager) {
    const inputKey = getExportEmbedOptionsKey(options);
    options.resetCache = false;
    if (eager.key === inputKey) {
      const dir = cli('utils/dir');
      await dir.removeAsync(options.bundleOutput);
      await dir.copyAsync(eager.options.bundleOutput, options.bundleOutput);
      if (eager.options.assetsDest && options.assetsDest) await dir.copyAsync(eager.options.assetsDest, options.assetsDest);
      console.log('info: Copied output to binary:', options.bundleOutput);
      return;
    }
    console.log('  Eager key:', eager.key);
    console.log('Request key:', inputKey);
    console.warn('warning: Eager bundle does not match new options, bundling again.');
  }
  await exportEmbedInternalAsync(projectRoot, options);
  cli('utils/exit').ensureProcessExitsAfterDelay();
}

/** Expo's exportEmbedInternalAsync with the Bun bundler. */
export async function exportEmbedInternalAsync(projectRoot: string, options: EmbedOptions) {
  const h = expoHelpers(projectRoot);
  const { platform } = options;
  const entryFile = path.resolve(options.entryFile);
  const bundleOutput = path.resolve(options.bundleOutput);
  const sourcemapOutput = options.sourcemapOutput ? path.resolve(options.sourcemapOutput) : undefined;
  const assetsDest = options.assetsDest ? path.resolve(options.assetsDest) : undefined;

  // a failed build must not leave an old bundle behind (on Apple platforms also the copy inside the built .app)
  fs.rmSync(bundleOutput, { force: true });
  if (isApple(platform)) {
    const previous = copiedAppleBundle(bundleOutput);
    if (previous) fs.rmSync(previous, { force: true });
  }

  const exp = h.req('@expo/config').getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp;
  const started = performance.now();
  let result;
  try {
    result = await bundle({
      projectRoot,
      entryFile,
      platform,
      dev: options.dev,
      minify: options.minify,
      bundleOutput,
      sourcemapOutput,
      sourceMapUrl: sourcemapOutput ? (options.sourcemapUseAbsolutePath ? sourcemapOutput : path.basename(sourcemapOutput)) : undefined,
      sourcemapSourcesRoot: options.sourcemapSourcesRoot,
      bundleEncoding: options.bundleEncoding ?? 'utf8',
      assetsDest,
      assetCatalogDest: options.assetCatalogDest ? path.resolve(options.assetCatalogDest) : undefined,
      transformProfile: options.unstableTransformProfile,
      workers: options.maxWorkers,
      // The transform cache is keyed by file content, so native scripts' --reset-cache is ignored by default.
      resetCache: !!options.resetCache && process.env.BUN_BUNDLER_HONOR_RESET_CACHE === '1',
      log: (m) => console.log(m),
    });
  } catch (e) {
    if (isApple(platform)) logErrorInXcode(projectRoot, e);
    throw e;
  }

  // `--bytecode`: Hermes bytecode instead of JS (Expo's serializer with `bytecode` + a Hermes engine)
  if (options.bytecode && h.isEnableHermesManaged(exp, platform)) {
    const map = sourcemapOutput ? fs.readFileSync(sourcemapOutput, 'utf8') : null;
    const out = await h.buildHermesBundleAsync({ projectRoot, filename: entryFile, code: result.code, map, minify: true });
    fs.writeFileSync(bundleOutput, out.hbc);
    if (sourcemapOutput && out.sourcemap) {
      const debugId = map ? JSON.parse(map).debugId : undefined;
      fs.writeFileSync(sourcemapOutput, debugId ? appendDebugId(out.sourcemap, debugId) : out.sourcemap);
    }
  }

  // Expo exports the API routes next to native builds of `web.output: "server"` projects (.expo/server/<platform>,
  // deployed with EXPO_UNSTABLE_DEPLOY_SERVER in eager mode)
  if (!options.skipServer && exp.web?.output === 'server') await exportStandaloneServerAsync(projectRoot, exp, options);

  // DOM components: www.bundle/<md5>.html + web bundles next to the native assets
  const { persistDomComponentsForEmbed } = await import('./dom');
  const dom = await persistDomComponentsForEmbed({ projectRoot, references: result.domComponents, dev: options.dev, platform, bundleOutput, assetsDest });
  const ms = Math.round(performance.now() - started);
  console.log(`${LABEL[platform]} Bundled ${ms}ms with Bun (${result.modules.length} files${dom ? `, ${dom} DOM components` : ''})`);
  console.log(`Writing bundle output to: ${bundleOutput}`);
  if (sourcemapOutput) console.log(`Writing sourcemap output to: ${sourcemapOutput}`);
  if (process.env.BUN_BUNDLER_TIMINGS) console.log(JSON.stringify(result.timings));
}

/** Expo's exportStandaloneServerAsync, given a dev-server facade that bundles the API routes with Bun. */
async function exportStandaloneServerAsync(projectRoot: string, exp: any, options: EmbedOptions) {
  const h = expoHelpers(projectRoot);
  const { exportApiRoutesAsync, getServerManifestAsync } = await import('./web-export');
  const routerRoot = getRouterRoot(projectRoot, exp);
  const appDir = path.join(projectRoot, routerRoot);
  const project = createProject({ projectRoot, platform: 'web', dev: options.dev, environment: 'node', exp, routerRoot, minify: options.minify });
  const devServer = {
    projectRoot,
    isReactServerComponentsEnabled: false,
    getServerManifestAsync: () => getServerManifestAsync({ projectRoot, exp, routerRoot, dev: options.dev }),
    exportExpoRouterApiRoutesAsync: async ({ includeSourceMaps, prerenderManifest }: any) => {
      const files = new Map();
      const manifest = await exportApiRoutesAsync({ project, appDir, files, includeSourceMaps });
      return { manifest: { ...manifest, htmlRoutes: prerenderManifest.htmlRoutes }, files };
    },
  };
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    await h.cli('export/embed/exportServer').exportStandaloneServerAsync(projectRoot, devServer, { exp, pkg, files: new Map(), options });
  } finally {
    project.close();
  }
}

/** Expo's guessCopiedAppleBundlePath: the bundle Xcode copied into the .app by a previous build. */
function copiedAppleBundle(bundleOutput: string): string | undefined {
  if (!/\/Xcode\/DerivedData\/.*\/Build\/Products\/|\/CoreSimulator\/Devices\/.*\/data\/Containers\/Bundle\/Application\//.test(bundleOutput)) return undefined;
  const parent = path.dirname(bundleOutput);
  const app = fs.readdirSync(parent).find((f) => f.endsWith('.app') && fs.existsSync(path.join(parent, f, path.basename(bundleOutput))));
  return app ? path.join(parent, app, path.basename(bundleOutput)) : undefined;
}

/** Bun.build / transform failures as Xcode compiler errors (`file:line:col: error: ...`), like Expo. */
function logErrorInXcode(projectRoot: string, error: any) {
  const logger = expoHelpers(projectRoot).cli('export/embed/xcodeCompilerLogger');
  if (!logger.isExecutingFromXcodebuild()) return;
  const message = String(error?.message ?? error);
  const unresolved = message.match(/Unable to resolve "(.+?)" from "(.+?)"/);
  if (unresolved) {
    const origin = unresolved[2].replace(/^[\s\S]*?(\/)/, '$1');
    logger.logMetroErrorInXcode(projectRoot, { message: message.split('\n').find((l) => l.includes('Unable to resolve')), originModulePath: origin, targetModuleName: unresolved[1] });
  } else {
    logger.logMetroErrorInXcode(projectRoot, { message: message.replace(/^Bun\.build failed:\n/, '') });
  }
}
