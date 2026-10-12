// Metro's serialization of the Bun dev graph (native platforms): the modules transformed by Metro's Transformer
// (./metro-transformer.ts) as Metro module objects, in Metro graph order, serialized by the configured serializer
// exactly as metro/Server does for a bundle request (`config.serializer.customSerializer` = Expo's, or Metro's
// baseJSBundle), with Metro's pre-modules (metro/lib/getPrependedScripts), module ids from the server-wide
// `config.serializer.createModuleIdFactory()` and maps from metro sourceMapString (Server._getSortedModules order).
import path from 'node:path';
import { createRequire } from 'node:module';

import type { ContextParams, MetroDependency, MetroTransformer } from './metro-transformer';
import { listContextFiles, type ContextSpec } from './shared';
import { metroRequire } from '../bun/metro-require';

export interface MetroModuleData {
  /** Metro module path: file, `\0virtual`, `<dir>?ctx=<hash>` */
  path: string;
  type: string;
  code: string;
  map: any[];
  functionMap: any | null;
  lineCount: number;
  /** Metro dependencies with the resolved Metro paths (null: unresolved optional dependency) */
  dependencies: { dep: MetroDependency; absolutePath: string | null }[];
  inverse: string[];
  getSource: () => Buffer;
}

const idFactories = new Map<string, (modulePath: string) => number>();

/** one module id factory per project, like the one Metro's Server creates (shared by all platforms and bundles) */
export function metroModuleId(projectRoot: string, config: any): (modulePath: string) => number {
  let f = idFactories.get(projectRoot);
  if (!f) idFactories.set(projectRoot, (f = config.serializer.createModuleIdFactory()));
  return f!;
}

export function createMetroSerializer(opts: { projectRoot: string; platform: string; transformer: MetroTransformer }) {
  const { projectRoot, platform, transformer } = opts;
  const config = transformer.config;
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const mreq = metroRequire(projectRoot);
  const CountingSet = mreq('metro/private/lib/CountingSet').default;
  const countLines = mreq('metro/private/lib/countLines').default;
  const createModuleId = metroModuleId(projectRoot, config);
  let preModules: Promise<any[]> | null = null;

  const moduleObject = (m: MetroModuleData) => ({
    path: m.path,
    dependencies: new Map(m.dependencies.map(({ dep, absolutePath }) => [dep.data.key, { absolutePath, data: dep }])),
    inverseDependencies: new CountingSet(m.inverse),
    output: [{ type: m.type, data: { code: m.code, map: m.map, functionMap: m.functionMap, lineCount: m.lineCount } }],
    getSource: m.getSource,
    unstable_transformResultKey: undefined,
  });

  /** metro/lib/getPrependedScripts: prelude + the module system and polyfills transformed as scripts */
  async function prepend(): Promise<any[]> {
    const getPreludeCode = mreq('metro/private/lib/getPreludeCode').default;
    const code = getPreludeCode({
      isDev: transformer.dev,
      globalPrefix: config.transformer.globalPrefix,
      requireCycleIgnorePatterns: config.resolver.requireCycleIgnorePatterns,
      unstable_forceFullRefreshPatterns: config.resolver.unstable_forceFullRefreshPatterns,
    });
    const prelude = {
      dependencies: new Map(),
      getSource: () => Buffer.from(code),
      inverseDependencies: new CountingSet(),
      path: '__prelude__',
      output: [{ type: 'js/script/virtual', data: { code, lineCount: countLines(code), map: [] } }],
    };
    // Expo resolves Metro's module system (metro-runtime/src/polyfills/require.js) to its own runtime
    const moduleSystem = req.resolve('@expo/cli/build/metro-require/require.js');
    const names: string[] = [moduleSystem, ...config.serializer.getPolyfills({ platform }), ...config.serializer.polyfillModuleNames];
    const scripts = [];
    for (const name of [...new Set(names)]) {
      const r = await transformer.transform(name, { type: 'script' });
      scripts.push(moduleObject({ path: name, type: r.output.type, code: r.output.code, map: r.output.map, functionMap: r.output.functionMap, lineCount: r.output.lineCount, dependencies: [], inverse: [], getSource: r.getSource }));
    }
    return [prelude, ...scripts];
  }

  function options(url: string) {
    // Server._processRequest + _parseOptions
    const parse = mreq('metro/private/lib/parseBundleOptionsFromBundleRequestUrl').default;
    const splitBundleOptions = mreq('metro/private/lib/splitBundleOptions').default;
    const toNormalUrl = mreq('jsc-safe-url').toNormalUrl;
    const { bundleType: _bundleType, ...bundleOptions } = parse(toNormalUrl(url), new Set(config.resolver.platforms));
    const split = splitBundleOptions(bundleOptions);
    return split as { serializerOptions: any; transformOptions: any; graphOptions: any; entryFile: string };
  }

  const shouldAddToIgnoreList = (module: any) => module.path === '__prelude__' || module.path.includes('?ctx=') || config.serializer.isThirdPartyModule(module);

  return {
    createModuleId,

    /** metro/HmrServer _prepareMessage: Expo's hmrJSBundle on the changed modules of the graph */
    hmr(delta: { added: MetroModuleData[]; modified: MetroModuleData[]; deleted: string[] }, modules: MetroModuleData[], clientUrl: string) {
      const hmrJSBundle = req('@expo/metro-config/build/serializer/fork/hmrJSBundle').default;
      const graph = { dependencies: new Map(modules.map((m) => [m.path, moduleObject(m)])) };
      const asMap = (list: MetroModuleData[]) => new Map(list.map((m) => [m.path, graph.dependencies.get(m.path) ?? moduleObject(m)]));
      return hmrJSBundle({ added: asMap(delta.added), modified: asMap(delta.modified), deleted: new Set(delta.deleted) }, graph, {
        clientUrl: new URL(clientUrl),
        createModuleId,
        includeAsyncPaths: new URL(clientUrl).searchParams.get('lazy') === 'true',
        projectRoot,
        serverRoot: config.server.unstable_serverRoot ?? projectRoot,
      });
    },

    /** the bundle (Server._processBundleRequest) and its map (Server._processSourceMapRequest) */
    async serialize(url: string, entryFile: string, modules: MetroModuleData[], runBeforeMainEntry: string): Promise<{ code: string; map: any }> {
      const { serializerOptions, transformOptions, graphOptions } = options(url);
      preModules ??= prepend();
      const prependModules = await preModules;
      const graph = { dependencies: new Map(modules.map((m) => [m.path, moduleObject(m)])), entryPoints: new Set([entryFile]), transformOptions };
      const serializer =
        config.serializer.customSerializer ||
        ((e: string, p: any[], g: any, o: any) => mreq('metro/private/lib/bundleToString').default(mreq('metro/private/DeltaBundler/Serializers/baseJSBundle').default(e, p, g, o)).code);
      const bundle = await serializer(entryFile, prependModules, graph, {
        asyncRequireModulePath: req.resolve(config.transformer.asyncRequireModulePath),
        processModuleFilter: config.serializer.processModuleFilter,
        createModuleId,
        getRunModuleStatement: config.serializer.getRunModuleStatement,
        globalPrefix: config.transformer.globalPrefix,
        includeAsyncPaths: graphOptions.lazy,
        dev: transformOptions.dev,
        projectRoot,
        modulesOnly: serializerOptions.modulesOnly,
        runBeforeMainModule: config.serializer.getModulesRunBeforeMainModule(path.relative(projectRoot, runBeforeMainEntry)),
        runModule: serializerOptions.runModule,
        sourceMapUrl: serializerOptions.sourceMapUrl,
        sourceUrl: serializerOptions.sourceUrl,
        inlineSourceMap: serializerOptions.inlineSourceMap,
        serverRoot: config.server.unstable_serverRoot ?? projectRoot,
        shouldAddToIgnoreList,
        getSourceUrl: (module: any) => module.path,
      });
      // Server._getSortedModules: ids in graph order, then sorted by id
      const sorted = [...graph.dependencies.values()];
      for (const m of sorted) createModuleId(m.path);
      sorted.sort((a: any, b: any) => createModuleId(a.path) - createModuleId(b.path));
      const { sourceMapStringNonBlocking } = mreq('metro/private/DeltaBundler/Serializers/sourceMapString');
      const map = await sourceMapStringNonBlocking([...(serializerOptions.modulesOnly ? [] : prependModules), ...sorted], {
        excludeSource: serializerOptions.excludeSource,
        processModuleFilter: config.serializer.processModuleFilter,
        shouldAddToIgnoreList,
        getSourceUrl: (module: any) => module.path,
      });
      return { code: typeof bundle === 'string' ? bundle : bundle.code, map: JSON.parse(map) };
    },
  };
}

export type MetroSerializer = ReturnType<typeof createMetroSerializer>;

/** metro/HmrServer _registerEntryPoint: the URL HMR modules are addressed with (`clientUrl`) */
export function metroHmrClientUrl(requestUrl: string): string {
  const clientUrl = new URL(requestUrl);
  clientUrl.protocol = 'http';
  const q = clientUrl.searchParams;
  q.delete('bundleEntry');
  q.set('dev', q.get('dev') || 'true');
  q.set('minify', q.get('minify') || 'false');
  q.set('modulesOnly', 'true');
  q.set('runModule', q.get('runModule') || 'false');
  q.set('shallow', 'true');
  return clientUrl.toString();
}

/**
 * Graph keys of a module's Metro dependencies (metro/DeltaBundler/Graph semantics): require.context modules, files a
 * context template requires (by absolute path), unresolved optional dependencies; `async` (lazy bundle) for every
 * dependency with an asyncType, except virtual modules, which stay in the requesting bundle.
 */
export function metroDependencyTargets(
  deps: MetroDependency[],
  from: string,
  context: { from: string } | undefined,
  keys: { resolve: (spec: string, from: string, isESM: boolean) => string; contextKey: (spec: ContextSpec) => string; missingKey: (spec: string) => string }
): { key: string; async: boolean }[] {
  return deps.map((dep) => {
    const data = dep.data;
    let target: string;
    if (data.contextParams) {
      const { recursive, filter, mode } = data.contextParams;
      target = keys.contextKey({ dir: path.resolve(path.dirname(from), dep.name), recursive, filter, mode });
    } else if (context) {
      target = keys.resolve(path.resolve(context.from, dep.name), path.join(context.from, 'index.js'), false);
    } else {
      try {
        target = keys.resolve(dep.name, from, !!data.isESMImport);
      } catch (e) {
        if (!data.isOptional) throw e;
        target = keys.missingKey(dep.name);
      }
    }
    return { key: target, async: data.asyncType != null && !target.startsWith('\0') };
  });
}

interface GraphModule {
  key: string;
  deps: string[];
  inverse: Set<string>;
  functionMap?: any;
  metro?: { code: string; map: any[]; type: string; lineCount: number; deps: MetroDependency[]; getSource: () => Buffer } | null;
}

/** metro/DeltaBundler/Graph reorderGraph: depth-first from the entry over every dependency that is in the graph */
export function metroGraphModules(entry: string, inGraph: Set<string>, get: (key: string) => GraphModule, metroPath: (key: string) => string, isMissing: (key: string) => boolean): MetroModuleData[] {
  const order: GraphModule[] = [];
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key) || !inGraph.has(key)) return;
    seen.add(key);
    const mod = get(key);
    order.push(mod);
    mod.deps.forEach(visit);
  };
  visit(entry);
  return order.map((mod) => ({
    path: metroPath(mod.key),
    type: mod.metro!.type,
    code: mod.metro!.code,
    map: mod.metro!.map,
    functionMap: mod.functionMap ?? null,
    lineCount: mod.metro!.lineCount,
    dependencies: mod.metro!.deps.map((dep, i) => ({ dep, absolutePath: isMissing(mod.deps[i]) ? null : metroPath(mod.deps[i]) })),
    inverse: [...mod.inverse].filter((k) => inGraph.has(k)).map(metroPath),
    getSource: mod.metro!.getSource,
  }));
}

/** metro/Server _createRequestProcessor reporter events: build started, transform progress, done or failed */
export async function reportBuild<T>(
  reporter: any,
  buildID: string,
  bundleDetails: object,
  isPrefetch: boolean,
  setProgress: (onProgress: ((transformedFileCount: number, totalFileCount: number) => void) | null) => void,
  build: () => Promise<T>
): Promise<T> {
  setProgress((transformedFileCount, totalFileCount) => reporter.update({ buildID, type: 'bundle_transform_progressed', transformedFileCount, totalFileCount }));
  reporter.update({ buildID, bundleDetails, isPrefetch, type: 'bundle_build_started' });
  try {
    const result = await build();
    reporter.update({ buildID, type: 'bundle_build_done' });
    return result;
  } catch (error) {
    reporter.update({ buildID, type: 'bundle_build_failed', bundleOptions: bundleDetails });
    reporter.update({ error, type: 'bundling_error' });
    throw error;
  } finally {
    setProgress(null);
  }
}

/** Transform a graph module with Metro: require.context modules from Metro's template of the matched files */
export async function loadMetroModule(
  t: MetroTransformer,
  key: string,
  file: string,
  keys: Parameters<typeof metroDependencyTargets>[3] & { contextSpec: (key: string) => ContextSpec | null; isAsset: (key: string) => boolean }
) {
  const contextSpec = keys.contextSpec(key);
  const context = contextSpec
    ? {
        mode: contextSpec.mode as ContextParams['mode'],
        from: contextSpec.dir,
        files: listContextFiles(contextSpec.dir, contextSpec.recursive, new RegExp(contextSpec.filter.pattern, contextSpec.filter.flags)).map((rel) => path.join(contextSpec.dir, rel)),
      }
    : undefined;
  const res = await t.transform(file, { context });
  return {
    contextSpec,
    functionMap: res.output.functionMap,
    metro: { code: res.output.code, map: res.output.map, type: res.output.type, lineCount: res.output.lineCount, deps: res.dependencies, getSource: res.getSource },
    specs: metroDependencyTargets(res.dependencies, keys.isAsset(key) ? file : key, context, keys),
  };
}
