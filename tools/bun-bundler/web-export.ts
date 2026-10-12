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
import { createProject, getAsyncRoutes, getRouterRoot, type Project } from './shared';
import { createLoaderRunner } from './loaders';
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

/**
 * Serial assets of one stylesheet (@expo/metro-config getCssSerialAssets): `css-external` `<link>`s for
 * `@import url(...)`, then the stylesheet (exports: a hashed file; dev: inlined with its HMR id).
 */
export function cssArtifacts(entry: WebBuildResult['css'][number], exporting: boolean): any[] {
  const { originFilename, css, externalImports } = entry;
  const hmrId = cssHmrId(originFilename);
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const externals = externalImports.map((ext) => ({
    type: 'css-external',
    originFilename,
    filename: ext.url,
    source: `<link rel="stylesheet" href="${esc(ext.url)}"${ext.media ? ` media="${esc(ext.media)}"` : ''}>`,
    metadata: { hmrId, media: ext.media ?? undefined },
  }));
  const filename = exporting ? `_expo/static/css/${path.basename(originFilename).replace(/\.\w+$/, '')}-${md5(css)}.css` : originFilename;
  return [...externals, { type: 'css', originFilename, filename, source: css, metadata: { hmrId } }];
}

/** Serial assets (Metro's `artifacts`) of a client build: what Expo's HTML serializer consumes. */
export function clientArtifacts(project: Project, build: WebBuildResult, opts: { dev: boolean; baseUrl: string; sourceMaps: boolean; entry: string }) {
  const head = [project.prelude(), ...polyfillsOf(project)].join('\n');
  const entryName = path.basename(opts.entry).replace(/\.\w+$/, '');
  const originFilename = path.relative(project.projectRoot, opts.entry);
  const artifacts: any[] = build.css.flatMap((entry) => cssArtifacts(entry, true));
  const jsMeta = (extra: object) => ({ isAsync: false, requires: [], modulePaths: build.modules, paths: {}, expoDomComponentReferences: [], reactClientReferences: [], reactServerReferences: [], ...extra });
  // code splitting: the entry is an ES module, so the prelude and polyfills (globals) run first as a classic script
  const split = build.chunks.length > 0;
  let runtimeName: string | null = null;
  if (split) {
    runtimeName = `_expo/static/js/web/runtime-${md5(head)}.js`;
    artifacts.push({ type: 'js', originFilename, filename: runtimeName, source: head, metadata: jsMeta({ modulePaths: [] }) });
  }
  const js = split ? build.code : `${head}\n${build.code}`;
  const filename = `_expo/static/js/web/${entryName}-${md5(js)}.js`;
  const source = opts.sourceMaps ? `${js}\n//# sourceMappingURL=${opts.baseUrl}/${filename}.map` : js;
  artifacts.push({ type: 'js', originFilename, filename, source, metadata: jsMeta({ requires: runtimeName ? [runtimeName] : [], esModule: split }) });
  if (opts.sourceMaps && build.map) {
    // the module graph starts below the (unmapped) prelude and polyfills
    const headLines = split ? 0 : head.split('\n').length;
    const map = { ...build.map, mappings: ';'.repeat(headLines) + build.map.mappings };
    artifacts.push({ type: 'map', originFilename, filename: `${filename}.map`, source: JSON.stringify(map), metadata: {} });
  }
  return artifacts;
}

/**
 * HTML for a split client: the entry becomes `<script type="module">` (module scripts run in document order with
 * the deferred runtime script) and the route's chunks are preloaded (`<link rel="modulepreload">`), like Metro
 * links a route's async chunks to its HTML.
 */
export function splitClientHtml(html: string, artifacts: any[], build: WebBuildResult, baseUrl: string, routeFiles: string[] = []) {
  const entry = artifacts.find((a) => a.type === 'js' && a.metadata?.esModule);
  if (!entry) return html;
  const src = `${baseUrl}/${entry.filename}`;
  html = html.replace(`<script src="${src}" defer></script>`, `<script type="module" src="${src}"></script>`);
  const wanted = new Set<string>();
  const add = (name: string) => {
    if (wanted.has(name)) return;
    wanted.add(name);
    build.chunks.find((c) => c.name === name)?.imports.forEach(add);
  };
  for (const c of build.chunks) if (c.inputs.some((i) => routeFiles.includes(i))) add(c.name);
  const links = [...wanted].map((n) => `<link rel="modulepreload" href="${baseUrl}/_expo/static/js/web/${n}">`).join('');
  return links ? html.replace('</head>', `${links}</head>`) : html;
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
  // the module file is strict like Metro's ES modules (the directive must open the file)
  return { src: `"use strict";\n${project.prelude()}\n${build.code}`, map: build.map ? { ...build.map, mappings: ';;' + build.map.mappings } : null };
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
  const useServerLoaders = !!exp.extra?.router?.unstable_useServerDataLoaders;

  // ---- client bundle
  const client = createProject({ projectRoot, platform: 'web', dev, exp, routerRoot, minify: opts.minify });
  let build: WebBuildResult;
  try {
    // expo-router asyncRoutes: route chunks (not with server rendering, whose asset list is classic scripts)
    const splitting = getAsyncRoutes(projectRoot, exp, dev ? 'development' : 'production', 'web') && !isExportingWithSSR;
    build = await buildWeb(client, [...client.runBeforeMain, entryFile], { kind: 'client', minify: opts.minify, sourcemap: opts.sourceMaps, baseUrl, splitting });
    await loadPolyfills(client);
  } finally {
    client.close();
  }
  const artifacts = clientArtifacts(client, build, { dev, baseUrl, sourceMaps: opts.sourceMaps, entry: entryFile });
  h.getFilesFromSerialAssets(artifacts, { platform: 'web', includeSourceMaps: opts.sourceMaps, files, isServerHosted: true });
  for (const chunk of build.chunks) files.set(`_expo/static/js/web/${chunk.name}`, { contents: chunk.code, targetDomain: 'client' });
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
    const html = h.serializeHtmlWithAssets({ isExporting: true, resources: artifacts, template, baseUrl });
    files.set('index.html', { contents: splitClientHtml(html, artifacts, build, baseUrl), targetDomain: 'client' });
    return { output, routes: 1, assets: build.assets.length };
  }

  // ---- static rendering (render.js for Bun, executed in this process)
  const server = createProject({ projectRoot, platform: 'web', dev, environment: 'node', exp, routerRoot, minify: opts.minify });
  let renderBuild: WebBuildResult;
  try {
    renderBuild = await buildWeb(server, [server.projectRequire.resolve('@expo/router-server/node/render.js')], { kind: 'render', minify: false });
  } finally {
    server.close();
  }
  const render = await importServerBundle(projectRoot, renderBuild.code, 'render');
  const loaders = useServerLoaders ? createLoaderRunner({ projectRoot, exp, routerRoot, dev, minify: opts.minify }) : null;
  const routerOptions = exp.extra?.router ?? {};
  const serverManifest = await render.getBuildTimeServerManifestAsync({ ...routerOptions, skipStaticParams: isExportingWithSSR });
  const manifest = await render.getManifest({ preserveApiRoutes: false, ...routerOptions });
  let routes = 0;
  // dynamic routes without generateStaticParams are rendered once with their `[param]` placeholders
  const placeholders: string[] = [];
  if (loaders) {
    // deterministic export: every route's loader bundle is ready before the (parallel) static rendering
    await loaders.preload(serverManifest.htmlRoutes.filter((r: any) => !r.generated).map((r: any) => path.resolve(appDir, r.file)));
  }
  if (!opts.skipSSG) {
    await h.getFilesToExportFromServerAsync(projectRoot, {
      files,
      manifest,
      serverManifest,
      exportServer,
      skipHtmlPrerendering: isExportingWithSSR,
      async renderAsync({ pathname, route, filePath }: { pathname: string; route: any; filePath: string }) {
        routes++;
        if (!exportServer && /\[[^/]+\]/.test(filePath)) placeholders.push(filePath);
        const normalized = pathname === '' ? '/' : pathname.startsWith('/') ? pathname : `/${pathname}`;
        const renderOpts: any = faviconAsset ? { assets: { css: [], js: [], favicon: faviconAsset.href } } : {};
        if (loaders) {
          // Expo exportStaticAsync: the loader runs at export time (no request), its data is written next to the HTML
          const resolved = h.fromRuntimeManifestRoute(new URL(normalized, 'http://localhost:8081').pathname, route, {
            serverManifest: h.inflateManifest(serverManifest),
            appDir,
          });
          const result = resolved ? await loaders.run(path.resolve(appDir, resolved.file), undefined, resolved.params) : undefined;
          if (result) {
            const data = result.value instanceof Response ? await result.value.json() : (result.value ?? null);
            const loaderKey = h.getContextKey(route.contextKey);
            files.set(`_expo/loaders${loaderKey}`, { contents: JSON.stringify(data, null, 2), targetDomain: 'client', loaderId: loaderKey });
            renderOpts.loader = { data, key: loaderKey };
          }
        }
        const template = await render.getStaticContent(new URL(normalized, 'http://localhost:8081'), renderOpts);
        const html = h.serializeHtmlWithAssets({ isExporting: true, resources: artifacts, template, baseUrl, route, hydrate: true });
        // the route's own files (and its layouts' files) are preloaded when the client is split
        // like Expo's makeRuntimeEntryPointsAbsolute: `./x` is relative to the router root, others are modules
        const routeFiles = ((route.entryPoints ?? [route.contextKey]) as string[]).filter(Boolean).map((ep) => {
          if (ep.startsWith('.')) return path.resolve(appDir, ep);
          if (path.isAbsolute(ep)) return ep;
          try {
            return require.resolve(ep, { paths: [appDir] });
          } catch {
            return ep;
          }
        });
        return splitClientHtml(html, artifacts, build, baseUrl, routeFiles);
      },
    });
  } else if (!exportServer) {
    throw new Error('--no-ssg can only be used with `web.output: server`');
  }

  if (placeholders.length) {
    opts.log(
      `Note: ${placeholders.sort().join(', ')} ${placeholders.length > 1 ? 'are' : 'is'} rendered with placeholder params (Expo static rendering). ` +
        'Serving such a page for a concrete URL makes React report a hydration mismatch (#418); export the paths with ' +
        '`generateStaticParams`, or use `web.output: "server"` with server rendering (https://docs.expo.dev/router/web/static-rendering/).'
    );
  }
  if (!exportServer) return { output, routes, assets: build.assets.length };

  // ---- server output: API routes, middleware, routes manifest (and the SSR render module)
  const publicPath = h.getPublicFolderPath(projectRoot);
  await h.copyPublicFolderAsync(publicPath, path.join(opts.outputDir, 'client'));
  const routesManifest = await h.fetchManifest(projectRoot, { ...routerOptions, preserveRedirectAndRewrites: true, asJson: true, appDir });
  if (!routesManifest) throw new Error('Unexpected error: server manifest could not be fetched.');
  const fnProject = createProject({ projectRoot, platform: 'web', dev, environment: 'node', exp, routerRoot, minify: opts.minify });
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
      if (loaders) {
        // Expo exportLoadersAsync: loader bundles of the routes whose client modules export a `loader`
        const withLoaders = new Set(build.loaderFiles);
        for (const route of serverManifest.htmlRoutes) {
          if (route.generated) continue;
          const file = path.isAbsolute(route.file) ? route.file : path.join(appDir, route.file);
          if (!withLoaders.has(file)) continue;
          const artifact = path.join('_expo/loaders', route.page.replace(/^\//, '') + '.js').split(path.sep).join('/');
          addServerFile(files, artifact, await loaders.bundle(file), { loaderId: route.page }, true);
          const r = routesJson.htmlRoutes.find((x: any) => x.page === route.page);
          if (r) r.loader = `_expo/loaders${route.page}.js`;
        }
      }
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
