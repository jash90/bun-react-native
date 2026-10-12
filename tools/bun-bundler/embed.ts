// `export:embed` on Bun - what Xcode / Gradle run for release builds, the counterpart of Expo CLI's exportEmbedAsync
// (@expo/cli/build/src/export/embed): same flags and defaults (`--dev` true, the project's entry when
// `--entry-file` is omitted, `--minify` = !dev), the old bundle (and on Apple platforms the copy inside the built
// .app) removed first so a failed build cannot ship it, `.env` files for the mode, `//# sourceMappingURL` +
// `//# debugId` annotations, `--bytecode` (Hermes), `--sourcemap-sources-root`, `--bundle-encoding`, Xcode-formatted
// errors, DOM components next to the assets.
import fs from 'node:fs';
import path from 'node:path';

import { bundle } from './bundle';
import { loadProjectEnv } from './env';
import { expoHelpers } from './expo-helpers';
import { appendDebugId } from './sourcemap';

type NativePlatform = 'ios' | 'android' | 'tvos' | 'macos';
const LABEL: Record<NativePlatform, string> = { ios: 'iOS', android: 'Android', tvos: 'tvOS', macos: 'macOS' };
const isApple = (p: NativePlatform) => p !== 'android';

/** Expo's guessCopiedAppleBundlePath: the bundle Xcode copied into the .app by a previous build. */
function copiedAppleBundle(bundleOutput: string): string | undefined {
  if (!/\/Xcode\/DerivedData\/.*\/Build\/Products\/|\/CoreSimulator\/Devices\/.*\/data\/Containers\/Bundle\/Application\//.test(bundleOutput)) return undefined;
  const parent = path.dirname(bundleOutput);
  const app = fs.readdirSync(parent).find((f) => f.endsWith('.app') && fs.existsSync(path.join(parent, f, path.basename(bundleOutput))));
  return app ? path.join(parent, app, path.basename(bundleOutput)) : undefined;
}

/** Bun.build / transform failures as Xcode compiler errors (`file:line:col: error: ...`), like Expo. */
function logErrorInXcode(projectRoot: string, error: any) {
  const logger = expoHelpers(projectRoot).req('@expo/cli/build/src/export/embed/xcodeCompilerLogger');
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

export async function exportEmbedAsync(args: Record<string, string>) {
  const projectRoot = path.resolve(args['project-root'] ?? process.cwd());
  const h = expoHelpers(projectRoot);
  const platform = (args.platform ?? 'ios') as NativePlatform;
  const dev = args.dev !== 'false';
  loadProjectEnv(projectRoot, dev ? 'development' : 'production');
  // RN's scripts pass --minify false for Hermes release builds; otherwise minify when !dev (Metro default).
  const minify = args.minify !== undefined ? args.minify === 'true' : !dev;
  if (!args['bundle-output']) throw new Error('Missing required argument: --bundle-output');
  const bundleOutput = path.resolve(args['bundle-output']);
  const sourcemapOutput = args['sourcemap-output'] ? path.resolve(args['sourcemap-output']) : undefined;
  const assetsDest = args['assets-dest'] ? path.resolve(args['assets-dest']) : undefined;
  const encoding = (args['bundle-encoding'] ?? 'utf8') as BufferEncoding;
  if (!['utf8', 'utf16le', 'ascii'].includes(encoding)) throw new Error(`Invalid --bundle-encoding "${encoding}" (utf8 | utf16le | ascii)`);

  // Expo: the project's entry (package.json `main`, e.g. expo-router/entry) when --entry-file is omitted
  const entryFile = path.resolve(projectRoot, args['entry-file'] ?? h.req('@expo/config/paths').resolveEntryPoint(projectRoot, { platform }));

  // `expo run:ios --configuration Release` / `run:android --variant release` pre-bundle with Metro and pass the
  // result here (Expo reuses it when the options match); copying it would ship Metro's bundle, so bundle with Bun.
  if (process.env.__EXPO_EAGER_BUNDLE_OPTIONS) console.log('info: ignoring the eager Metro bundle of `expo run` (bundling with Bun)');
  fs.rmSync(bundleOutput, { force: true });
  if (isApple(platform)) {
    const previous = copiedAppleBundle(bundleOutput);
    if (previous) fs.rmSync(previous, { force: true });
  }

  const started = performance.now();
  let result;
  try {
    result = await bundle({
      projectRoot,
      entryFile,
      platform,
      dev,
      minify,
      bundleOutput,
      sourcemapOutput,
      sourceMapUrl: sourcemapOutput ? (args['sourcemap-use-absolute-path'] === 'true' ? sourcemapOutput : path.basename(sourcemapOutput)) : undefined,
      sourcemapSourcesRoot: args['sourcemap-sources-root'],
      bundleEncoding: encoding,
      assetsDest,
      assetCatalogDest: args['asset-catalog-dest'] ? path.resolve(args['asset-catalog-dest']) : undefined,
      workers: args['max-workers'] ? Number(args['max-workers']) : undefined,
      // The transform cache is keyed by file content, so native scripts' --reset-cache is ignored by default.
      resetCache: args['reset-cache'] === 'true' && process.env.BUN_BUNDLER_HONOR_RESET_CACHE === '1',
      log: (m) => console.log(m),
    });
  } catch (e) {
    if (isApple(platform)) logErrorInXcode(projectRoot, e);
    throw e;
  }

  // `--bytecode`: Hermes bytecode instead of JS (Expo's serializer with `bytecode` + a Hermes engine)
  if (args.bytecode === 'true' && h.isEnableHermesManaged(getExp(projectRoot), platform)) {
    const map = sourcemapOutput ? fs.readFileSync(sourcemapOutput, 'utf8') : null;
    const out = await h.buildHermesBundleAsync({ projectRoot, filename: entryFile, code: result.code, map, minify: true });
    fs.writeFileSync(bundleOutput, out.hbc);
    if (sourcemapOutput && out.sourcemap) {
      const debugId = map ? JSON.parse(map).debugId : undefined;
      fs.writeFileSync(sourcemapOutput, debugId ? appendDebugId(out.sourcemap, debugId) : out.sourcemap);
    }
  }

  // DOM components: www.bundle/<md5>.html + web bundles next to the native assets (Expo exportEmbedAsync)
  const { persistDomComponentsForEmbed } = await import('./dom');
  const dom = await persistDomComponentsForEmbed({ projectRoot, references: result.domComponents, dev, platform, bundleOutput, assetsDest });
  const ms = Math.round(performance.now() - started);
  console.log(`${LABEL[platform]} Bundled ${ms}ms with Bun (${result.modules.length} files${dom ? `, ${dom} DOM components` : ''})`);
  console.log(`Writing bundle output to: ${bundleOutput}`);
  if (sourcemapOutput) console.log(`Writing sourcemap output to: ${sourcemapOutput}`);
  if (process.env.BUN_BUNDLER_TIMINGS) console.log(JSON.stringify(result.timings));
}

function getExp(projectRoot: string) {
  return expoHelpers(projectRoot).req('@expo/config').getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp;
}
