// Metro's own module transformation for the Bun dev server: metro/DeltaBundler/Transformer (Metro's transform
// cache in config.cacheStores) with the project's Metro config as Expo CLI composes it (./metro-config.ts), its
// transformerPath (Expo's transform worker, or a custom one) on Bun worker threads (tools/bun/metro-worker-farm.js).
// Per-file options follow metro/lib/transformHelpers (calcTransformerOptions, getType, require.context templates) and
// Expo CLI's transformFile patch (pruneCustomTransformOptions, instantiateMetro.js). The result is exactly what Metro
// serves for a module: `__d(function (...) {...});` without the define-call parameters, Metro dependencies, packed map.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { loadExpoMetroConfig } from './metro-config';
import { metroRequire } from '../bun/metro-require';

export interface MetroDependency {
  name: string;
  data: { asyncType: 'async' | 'prefetch' | 'weak' | 'maybeSync' | null; isOptional?: boolean; isESMImport?: boolean; contextParams?: ContextParams; key: string };
}

export interface ContextParams {
  recursive: boolean;
  filter: { pattern: string; flags: string };
  mode: 'sync' | 'eager' | 'lazy' | 'lazy-once';
}

export interface MetroModuleOutput {
  type: string;
  code: string;
  /** raw Metro mappings (MetroSourceMapSegmentTuple[]) */
  map: any[];
  functionMap: any | null;
  lineCount: number;
}

export interface MetroTransformResult {
  output: MetroModuleOutput;
  dependencies: MetroDependency[];
  /** the transformed source (file, virtual module contents, context module template) */
  getSource: () => Buffer;
}

export interface MetroTransformer {
  config: any;
  dev: boolean;
  /** contents of a `\0` virtual module (Expo registers most of them itself) */
  setVirtualModule(id: string, contents: string): void;
  transform(filePath: string, opts: { type?: 'module' | 'script'; context?: { mode: ContextParams['mode']; from: string; files: string[] } }): Promise<MetroTransformResult>;
  end(): Promise<void>;
}

export async function createMetroTransformer(opts: {
  projectRoot: string;
  platform: string;
  dev: boolean;
  minify: boolean;
  entryFile: string;
  customTransformOptions: Record<string, string>;
  transformProfile: string;
}): Promise<MetroTransformer> {
  const { projectRoot } = opts;
  const req = createRequire(path.join(projectRoot, 'package.json'));
  require('../bun/metro-worker-farm').install(projectRoot);
  const loaded = await loadExpoMetroConfig(projectRoot, { isExporting: false });
  const { config } = loaded;
  const own = new Map<string, Buffer>();
  const mreq = metroRequire(projectRoot);
  const Transformer = mreq('metro/private/DeltaBundler/Transformer').default;
  const { getContextModuleTemplate } = mreq('metro/private/lib/contextModuleTemplates');
  const isAssetFile = mreq('metro-resolver/private/utils/isAssetFile').default;
  const { materializeMap } = req('@expo/metro-config/build/serializer/packedMap');

  const sha1 = (b: Buffer) => crypto.createHash('sha1').update(b).digest('hex');
  const transformer = new Transformer(config, {
    getOrComputeSha1: async (file: string) => {
      // Expo's virtual modules live in its stand-in file system (registered while the config is used)
      const content = loaded.virtualModules.get(file) ?? own.get(file) ?? fs.readFileSync(file);
      return { content, sha1: sha1(content) };
    },
  });

  // metro/lib/transformHelpers calcTransformerOptions; custom options as in Expo's bundle URL (transform.*), which
  // omits empty ones (createBundleUrlSearchParams)
  const customTransformOptions = Object.fromEntries(Object.entries(opts.customTransformOptions).filter(([k, v]) => v !== '' && !(k === 'reactCompiler' && v === 'false')));
  const base = {
    customTransformOptions,
    dev: opts.dev,
    inlinePlatform: true,
    inlineRequires: false,
    minify: opts.minify,
    platform: opts.platform,
    unstable_transformProfile: opts.transformProfile,
  };
  const { transform: fromConfig } = (await config.transformer.getTransformOptions([path.resolve(projectRoot, opts.entryFile)], { dev: opts.dev, hot: true, platform: opts.platform }, async () => [])) ?? {};
  const { inlineRequires, ...moduleOptions } = {
    ...base,
    experimentalImportSupport: fromConfig?.experimentalImportSupport || false,
    inlineRequires: fromConfig?.inlineRequires || false,
    nonInlinedRequires: fromConfig?.nonInlinedRequires || BASE_IGNORED_INLINE_REQUIRES,
    type: 'module' as string,
    unstable_memoizeInlineRequires: fromConfig?.unstable_memoizeInlineRequires || false,
    unstable_nonMemoizedInlineRequires: fromConfig?.unstable_nonMemoizedInlineRequires || [],
  };
  const assetExts = new Set<string>(config.resolver.assetExts);

  return {
    config,
    dev: opts.dev,
    setVirtualModule: (id, contents) => void own.set(id, Buffer.from(contents)),
    async transform(filePath, { type = 'module', context }) {
      const options =
        type === 'script'
          ? { ...base, type: 'script' }
          : {
              ...moduleOptions,
              inlineRequires: typeof inlineRequires === 'object' ? !(filePath in inlineRequires.blockList) : inlineRequires,
              type: isAssetFile(filePath, assetExts) ? 'asset' : 'module',
            };
      // like Expo's getMetroBundlerWithVirtualModules: virtual modules are transformed from their contents
      const fileBuffer = context
        ? Buffer.from(getContextModuleTemplate(context.mode, context.from, context.files))
        : filePath.startsWith('\0')
          ? (loaded.virtualModules.get(filePath) ?? own.get(filePath))
          : undefined;
      const result = await transformer.transformFile(filePath, pruneCustomTransformOptions(projectRoot, filePath, { ...options, customTransformOptions: { __proto__: null, ...options.customTransformOptions } }), fileBuffer);
      const out = result.output[0];
      return {
        output: { type: out.type, code: out.data.code, map: materializeMap(out.data.map), functionMap: out.data.functionMap ?? null, lineCount: out.data.lineCount },
        dependencies: result.dependencies,
        getSource: () => result.getSource(),
      };
    },
    end: () => transformer.end(),
  };
}

/** metro/lib/transformHelpers baseIgnoredInlineRequires (not exported) */
const BASE_IGNORED_INLINE_REQUIRES = ['React', 'react', 'react/jsx-dev-runtime', 'react/jsx-runtime', 'react-compiler-runtime', 'react-native'];

/** Expo CLI instantiateMetro.js pruneCustomTransformOptions (not exported): options only a few files read */
function pruneCustomTransformOptions(projectRoot: string, filePath: string, transformOptions: any) {
  filePath = filePath.split(path.sep).join('/');
  const custom = transformOptions.customTransformOptions;
  if (custom?.dom && !filePath.match(/expo\/dom\/entry\.js$/)) custom.dom = 'true';
  if (typeof custom?.routerRoot === 'string') {
    const isRouterEntry = /\/expo-router\/_ctx/.test(filePath);
    const isRouterModule = /\/expo-router\/build\//.test(filePath);
    const resolvedRouterRoot = path.resolve(projectRoot, custom.routerRoot).split(path.sep).join('/');
    const isRouterRoute = path.isAbsolute(filePath) && filePath.startsWith(resolvedRouterRoot);
    if (!isRouterEntry && !isRouterModule && !isRouterRoute) custom.routerRoot = 'app';
  }
  if (custom?.asyncRoutes && !(filePath.match(/\/expo-router\/_ctx/) || filePath.match(/\/expo-router\/build\//))) delete custom.asyncRoutes;
  if (custom?.clientBoundaries && !filePath.match(/\/expo\/virtual\/rsc\.js$/)) delete custom.clientBoundaries;
  return transformOptions;
}
