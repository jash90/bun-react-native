// Web export of the Bun bundler (`expo export --platform web` without Metro), for every `web.output`:
//
//   single - index.html (Expo's template) + client bundle
//   static - client bundle + static rendering of every route: the server bundle of
//            `@expo/router-server/node/render.js` (Bun.build, target bun, executed here) -> getManifest()
//            (with generateStaticParams) -> getStaticContent(url) per HTML file, including `[param].html`
//            files for dynamic routes and group variations
//   server - like static, into dist/client + dist/server, plus API routes / middleware as CommonJS modules
//            in dist/server/_expo/functions and dist/server/_expo/routes.json for expo-server;
//            with `unstable_useServerRendering` the render module (dist/server/_expo/server/render.js)
//            instead of prerendered HTML
//
// Route enumeration, HTML serialization, favicon, public folder and file layout use Expo CLI's own functions
// (./expo-helpers.ts), so the output matches `expo export`; bundling is Bun's (./web.ts).
import fs from 'node:fs';
import path from 'node:path';

import { expoHelpers, type ExportFiles } from './expo-helpers';
import { createProject, getRouterRoot, type Project } from './shared';
import { buildWeb, cssHmrId, md5, webAssetFiles, type WebBuildResult } from './web';

export interface WebExportOptions {
  projectRoot: string;
  /** absolute output directory (files are collected in `files` and written by the caller) */
  outputDir: string;
  files: ExportFiles;
  exp: any;
  baseUrl: string;
  dev: boolean;
  minify: boolean;
  sourceMaps: boolean;
  /** `--no-ssg`: server output without prerendered HTML (API routes only) */
  skipSSG?: boolean;
  log: (msg: string) => void;
}

/** Serial assets (Metro's `artifacts`) of a client build: what Expo's HTML serializer consumes. */
export function clientArtifacts(project: Project, build: WebBuildResult, opts: { dev: boolean; baseUrl: string; sourceMaps: boolean; entry: string }) {
  const js = [project.prelude(), ...polyfillsOf(project), build.code].join('\n');
  const entryName = path.basename(opts.entry).replace(/\.\w+$/, '');
  const filename = `_expo/static/js/web/${entryName}-${md5(js)}.js`;
  const artifacts: any[] = build.css.map(({ originFilename, css }) => ({
    type: 'css',
    originFilename,
    filename: `_expo/static/css/${path.basename(originFilename).replace(/\.\w+$/, '')}-${md5(css)}.css`,
    source: css,
    metadata: { hmrId: cssHmrId(originFilename) },
  }));
  const source = opts.sourceMaps ? `${js}\n//# sourceMappingURL=${opts.baseUrl}/${filename}.map` : js;
  artifacts.push({
    type: 'js',
    originFilename: path.relative(project.projectRoot, opts.entry),
    filename,
    source,
    metadata: { isAsync: false, requires: [], modulePaths: build.modules, paths: {}, expoDomComponentReferences: [], reactClientReferences: [], reactServerReferences: [] },
  });
  if (opts.sourceMaps && build.map) {
    // the module graph starts below the (unmapped) prelude and polyfills
    const headLines = [project.prelude(), ...polyfillsOf(project)].join('\n').split('\n').length;
    const map = { ...build.map, mappings: ';'.repeat(headLines) + build.map.mappings };
    artifacts.push({ type: 'map', originFilename: path.relative(project.projectRoot, opts.entry), filename: `${filename}.map`, source: JSON.stringify(map), metadata: {} });
  }
  return artifacts;
}

const polyfillCache = new WeakMap<Project, string[]>();
function polyfillsOf(project: Project) {
  const p = polyfillCache.get(project);
  if (!p) throw new Error('polyfills not loaded');
  return p;
}
export async function loadPolyfills(project: Project) {
  polyfillCache.set(project, await project.polyfillSources());
}

/** Import an ES module bundle (render.js) built for Bun from a content-addressed file. */
export async function importServerBundle(projectRoot: string, code: string, name: string): Promise<any> {
  const dir = path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler', 'web-server');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${md5(code)}.mjs`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, code);
  const mod = await import(file);
  const api = typeof mod.getStaticContent === 'function' ? mod : mod.default;
  if (!api || typeof api.getStaticContent !== 'function') throw new Error(`${name} bundle does not export getStaticContent`);
  return api;
}

/** CommonJS module for expo-server (API route, middleware, SSR render module) + its source map. */
export async function buildServerFunction(project: Project, file: string, opts: { minify: boolean }) {
  const build = await buildWeb(project, [file], { kind: 'function', minify: opts.minify, sourcemap: true });
  return { src: `${project.prelude()}\n${build.code}`, map: build.map ? { ...build.map, mappings: ';' + build.map.mappings } : null };
}

/** Same layout as Expo CLI's exportServerRouteAsync: `name.js` + `name.js.map` in the server domain. */
function addServerFile(files: ExportFiles, artifactFilename: string, contents: { src: string; map: any }, descriptor: Record<string, string>, sourceMaps: boolean) {
  let src = contents.src;
  if (sourceMaps && contents.map) {
    src += `\n//# sourceMappingURL=${encodeURIComponent(path.basename(artifactFilename) + '.map')}`;
    files.set(artifactFilename + '.map', {
      ...descriptor,
      contents: JSON.stringify({
        version: contents.map.version,
        sources: contents.map.sources.map((s: string) => s.split(path.sep).join('/')),
        sourcesContent: new Array(contents.map.sources.length).fill(null),
        names: contents.map.names,
        mappings: contents.map.mappings,
      }),
      targetDomain: 'server',
    });
  }
  files.set(artifactFilename, { ...descriptor, contents: src, targetDomain: 'server' });
}

export async function exportWebAsync(opts: WebExportOptions) {
  const { projectRoot, files, exp, baseUrl, dev } = opts;
  const h = expoHelpers(projectRoot);
  const output: 'single' | 'static' | 'server' = exp.web?.output ?? 'single';
  const routerRoot = getRouterRoot(projectRoot, exp);
  const appDir = path.join(projectRoot, routerRoot);
  const entry = path.join(projectRoot, h.resolveRelativeEntryPoint(projectRoot, { platform: 'web' }));
  const entryFile = require.resolve(entry, { paths: [projectRoot] });
  const exportServer = output === 'server';
  const useServerRendering = exp.extra?.router?.unstable_useServerRendering ?? false;
  const isExportingWithSSR = exportServer && useServerRendering;
  if (exp.extra?.router?.unstable_useServerDataLoaders) {
    throw new Error('expo-router `unstable_useServerDataLoaders` is not supported by the Bun bundler yet (use RN_BUNDLER=metro)');
  }

  // ---- client bundle
  const client = createProject({ projectRoot, platform: 'web', dev, exp, routerRoot });
  let build: WebBuildResult;
  try {
    build = await buildWeb(client, [...client.runBeforeMain, entryFile], { kind: 'client', minify: opts.minify, sourcemap: opts.sourceMaps, baseUrl });
    await loadPolyfills(client);
  } finally {
    client.close();
  }
  const artifacts = clientArtifacts(client, build, { dev, baseUrl, sourceMaps: opts.sourceMaps, entry: entryFile });
  h.getFilesFromSerialAssets(artifacts, { platform: 'web', includeSourceMaps: opts.sourceMaps, files, isServerHosted: true });
  // web assets: Expo names them `name.<hash>` and writes every scale below `assets/`
  for (const [dest, src] of webAssetFiles(build.assets)) {
    files.set(dest.replace(new RegExp(`^${baseUrl.replace(/^\//, '')}/?`), ''), {
      contents: fs.readFileSync(src),
      assetId: path.relative(projectRoot, src).replace(/(@\d+(\.\d+)?x)?(\.\w+)$/, '$3'),
      targetDomain: 'client',
    });
  }
  const faviconAsset = await h.generateFaviconAssetAsync(projectRoot, { outputDir: opts.outputDir, baseUrl, files, exp });

  if (output === 'single') {
    const template = await h.createTemplateHtmlFromExpoConfigAsync(projectRoot, {
      scripts: [],
      cssLinks: [],
      extraHead: faviconAsset ? h.createFaviconAsString(faviconAsset.href) : undefined,
      exp,
    });
    files.set('index.html', { contents: h.serializeHtmlWithAssets({ isExporting: true, resources: artifacts, template, baseUrl }), targetDomain: 'client' });
    return { output, routes: 1, assets: build.assets.length };
  }

  // ---- static rendering (render.js for Bun, executed in this process)
  const server = createProject({ projectRoot, platform: 'web', dev, environment: 'node', exp, routerRoot });
  let renderBuild: WebBuildResult;
  try {
    renderBuild = await buildWeb(server, [server.projectRequire.resolve('@expo/router-server/node/render.js')], { kind: 'render', minify: false });
  } finally {
    server.close();
  }
  const render = await importServerBundle(projectRoot, renderBuild.code, 'render');
  const routerOptions = exp.extra?.router ?? {};
  const serverManifest = await render.getBuildTimeServerManifestAsync({ ...routerOptions, skipStaticParams: isExportingWithSSR });
  const manifest = await render.getManifest({ preserveApiRoutes: false, ...routerOptions });
  let routes = 0;
  if (!opts.skipSSG) {
    await h.getFilesToExportFromServerAsync(projectRoot, {
      files,
      manifest,
      serverManifest,
      exportServer,
      skipHtmlPrerendering: isExportingWithSSR,
      async renderAsync({ pathname, route }: { pathname: string; route: any }) {
        routes++;
        const normalized = pathname === '' ? '/' : pathname.startsWith('/') ? pathname : `/${pathname}`;
        const renderOpts = faviconAsset ? { assets: { css: [], js: [], favicon: faviconAsset.href } } : {};
        const template = await render.getStaticContent(new URL(normalized, 'http://localhost:8081'), renderOpts);
        return h.serializeHtmlWithAssets({ isExporting: true, resources: artifacts, template, baseUrl, route, hydrate: true });
      },
    });
  } else if (!exportServer) {
    throw new Error('--no-ssg can only be used with `web.output: server`');
  }

  if (!exportServer) return { output, routes, assets: build.assets.length };

  // ---- server output: API routes, middleware, routes manifest (and the SSR render module)
  const publicPath = h.getPublicFolderPath(projectRoot);
  await h.copyPublicFolderAsync(publicPath, path.join(opts.outputDir, 'client'));
  const routesManifest = await h.fetchManifest(projectRoot, { ...routerOptions, preserveRedirectAndRewrites: true, asJson: true, appDir });
  if (!routesManifest) throw new Error('Unexpected error: server manifest could not be fetched.');
  const fnProject = createProject({ projectRoot, platform: 'web', dev, environment: 'node', exp, routerRoot });
  try {
    const bundleFn = (file: string) => buildServerFunction(fnProject, file, { minify: opts.minify });
    const outputDir = '_expo/functions';
    if (routesManifest.middleware) {
      const file = path.isAbsolute(routesManifest.middleware.file) ? routesManifest.middleware.file : path.join(appDir, routesManifest.middleware.file);
      const artifact = path.join(outputDir, path.relative(appDir, file.replace(/\.[tj]sx?$/, '.js'))).split(path.sep).join('/');
      addServerFile(files, artifact, await bundleFn(file), { middlewareId: '/middleware' }, true);
      routesManifest.middleware.file = artifact;
    }
    for (const route of routesManifest.apiRoutes) {
      const file = path.isAbsolute(route.file) ? route.file : path.join(appDir, route.file);
      const artifact = path.join(outputDir, path.relative(appDir, file.replace(/\.[tj]sx?$/, '.js'))).split(path.sep).join('/');
      addServerFile(files, artifact, await bundleFn(file), { apiRouteId: route.page }, true);
      route.file = artifact;
    }
    const routesJson: any = { ...routesManifest, htmlRoutes: serverManifest.htmlRoutes };
    if (opts.skipSSG) {
      routesJson.htmlRoutes = [];
      routesJson.notFoundRoutes = [];
    }
    if (isExportingWithSSR) {
      const renderModule = await buildServerFunction(fnProject, fnProject.projectRequire.resolve('@expo/router-server/node/render.js'), { minify: opts.minify });
      addServerFile(files, '_expo/server/render.js', renderModule, {}, true);
      const toUrl = (f: string) => (baseUrl ? `${baseUrl}/${f}` : `/${f}`);
      routesJson.assets = {
        css: artifacts.filter((a) => a.type === 'css').map((a) => toUrl(a.filename)),
        externalCss: [],
        js: artifacts.filter((a) => a.type === 'js').map((a) => toUrl(a.filename)),
        favicon: faviconAsset?.href,
      };
      routesJson.rendering = { mode: 'ssr', file: '_expo/server/render.js' };
    }
    files.set('_expo/routes.json', { contents: JSON.stringify(routesJson, null, 2), targetDomain: 'server' });
    if (opts.skipSSG && !fs.existsSync(path.join(opts.outputDir, 'client/index.html'))) {
      files.set('index.html', { contents: '<html><body></body></html>', targetDomain: 'client' });
    }
    return { output, routes, assets: build.assets.length, apiRoutes: routesManifest.apiRoutes.length };
  } finally {
    fnProject.close();
  }
}
