// Web routes of the Bun dev server, like Expo CLI's dev server for each `web.output`:
//
//   single         - Expo's index.html template with the dev bundle for every HTML request (history fallback)
//   static/server  - expo-server's request handler (Bun adapter) with:
//                      getHtml      -> static rendering of the URL with a development build of
//                                      `@expo/router-server/node/render.js` (Bun.build, imported here), client CSS
//                                      inlined as `<style data-expo-css-hmr>` (replaced in place by CSS HMR), the
//                                      dev bundle script, hydration only with EXPO_WEB_DEV_HYDRATE=1 (as Expo)
//                      getApiRoute  -> the `+api` file built to CommonJS and loaded (rebuilt after changes)
//                      getMiddleware-> `+middleware` the same way (`unstable_useServerMiddleware`)
//   public/        - files served as-is; /favicon.ico generated from `web.favicon` like Expo's favicon middleware
//
// Server-side builds are cached and dropped on every file change (`invalidate()` from the file watcher).
import fs from 'node:fs';
import path from 'node:path';

import { expoHelpers } from './expo-helpers';
import { createProject, getBaseUrl, getExpoConfig, getRouterRoot } from './shared';
import { buildWeb, md5, type WebBuildResult } from './web';
import { createLoaderRunner, type LoaderRunner } from './loaders';
import { buildServerFunction, cssArtifacts, importServerBundle } from './web-export';

export function createWebDevHandler(opts: { projectRoot: string; port: number }) {
  const { projectRoot } = opts;
  const h = expoHelpers(projectRoot);
  let exp = getExpoConfig(projectRoot);
  let rendering: Promise<{ render: any; css: WebBuildResult['css'] }> | null = null;
  const functions = new Map<string, Promise<any>>();
  let handler: ((request: Request) => Promise<Response>) | null = null;

  const output = () => (exp.web?.output ?? 'single') as 'single' | 'static' | 'server';
  const routerRoot = () => getRouterRoot(projectRoot, exp);
  const devBundleUrl = () => {
    const entry = h.resolveRelativeEntryPoint(projectRoot, { platform: 'web' });
    return `/${entry}.bundle?platform=web&dev=true&hot=false&transform.routerRoot=${encodeURIComponent(routerRoot())}`;
  };

  /** development build of render.js + the client CSS (dev, unminified) */
  function loadRender() {
    rendering ??= (async () => {
      const project = createProject({ projectRoot, platform: 'web', dev: true, environment: 'node', exp });
      try {
        const build = await buildWeb(project, [project.projectRequire.resolve('@expo/router-server/node/render.js')], { kind: 'render', minify: false });
        return { render: await importServerBundle(projectRoot, build.code, 'render-dev'), css: build.css };
      } finally {
        project.close();
      }
    })();
    rendering.catch(() => (rendering = null));
    return rendering;
  }

  /** `+api` / `+middleware` file as a fresh CommonJS module */
  function loadFunction(file: string) {
    let p = functions.get(file);
    if (!p) {
      p = (async () => {
        const project = createProject({ projectRoot, platform: 'web', dev: true, environment: 'node', exp });
        try {
          const { src } = await buildServerFunction(project, file, { minify: false });
          const dir = path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler', 'web-functions');
          fs.mkdirSync(dir, { recursive: true });
          const out = path.join(dir, `${path.basename(file).replace(/\W+/g, '_')}-${md5(src)}.cjs`);
          if (!fs.existsSync(out)) fs.writeFileSync(out, src);
          delete require.cache[out];
          return require(out);
        } finally {
          project.close();
        }
      })();
      p.catch(() => functions.delete(file));
      functions.set(file, p);
    }
    return p;
  }

  const useServerLoaders = () => !!exp.extra?.router?.unstable_useServerDataLoaders;
  const isSSREnabled = () => output() === 'server' && exp.extra?.router?.unstable_useServerRendering === true;
  let loaders: LoaderRunner | null = null;
  const loaderRunner = () =>
    (loaders ??= createLoaderRunner({ projectRoot, exp, routerRoot: routerRoot(), dev: true, minify: false }));

  /** Expo getDevServerRenderOptionsAsync / executeServerDataLoaderAsync for a server manifest route */
  async function runLoader(request: Request, route: any) {
    const url = new URL(request.url);
    const resolved = h.fromServerManifestRoute(url.pathname, route);
    if (!resolved) return null;
    const file = path.resolve(projectRoot, routerRoot(), resolved.file);
    // the request is only passed with server rendering; static rendering gets no request data
    const result = await loaderRunner().run(file, isSSREnabled() ? request : undefined, resolved.params);
    if (!result) return null;
    return { resolved, value: result.value };
  }

  /** Expo getStaticPageAsync with server rendering: streaming render with request, metadata and loader data */
  async function streamHtml(request: Request, route: any) {
    const { render, css } = await loadRender();
    const location = new URL(request.url);
    const resources = css.flatMap((entry) => cssArtifacts(entry, false));
    const inlineCss = resources.filter((a) => a.type === 'css').map((a) => ({ source: a.source, hmrId: a.metadata.hmrId }));
    const externalCss = resources.filter((a) => a.type === 'css-external').map((a) => ({ href: a.filename, media: a.metadata.media }));
    const resolved = h.fromServerManifestRoute(location.pathname, route);
    const params = resolved?.params ?? {};
    const metadata = await render.resolveMetadata({ route: { file: route.file, page: route.page }, request, params });
    let loader: any;
    if (useServerLoaders()) {
      const loaded = await runLoader(request, route);
      if (loaded) {
        const data = loaded.value instanceof Response ? await loaded.value.json() : loaded.value;
        loader = { data: data ?? null, key: h.resolveLoaderContextKey(loaded.resolved.contextKey, loaded.resolved.params) };
      }
    }
    return render.getStreamingContent(location, { loader, metadata, request, assets: { css: [], externalCss, inlineCss, js: [devBundleUrl()] } });
  }

  async function renderHtml(request: Request, route: any) {
    if (isSSREnabled()) return streamHtml(request, route);
    const { render, css } = await loadRender();
    const location = new URL(request.url);
    let renderOpts: any;
    if (useServerLoaders()) {
      const loaded = await runLoader(request, route);
      if (loaded) {
        const data = loaded.value instanceof Response ? await loaded.value.json() : (loaded.value ?? null);
        renderOpts = { loader: { data, key: h.resolveLoaderContextKey(loaded.resolved.contextKey, loaded.resolved.params) } };
      }
    }
    const template = await render.getStaticContent(new URL(location.pathname + location.search, `http://localhost:${opts.port}`), renderOpts);
    const resources = css.flatMap((entry) => cssArtifacts(entry, false));
    return h.serializeHtmlWithAssets({
      isExporting: false,
      resources,
      template,
      devBundleUrl: devBundleUrl(),
      baseUrl: getBaseUrl(projectRoot, exp),
      hydrate: /^(1|true)$/i.test(process.env.EXPO_WEB_DEV_HYDRATE ?? ''),
    });
  }

  async function errorPage(error: any) {
    console.error(error?.stack ?? error);
    try {
      return new Response(await h.getErrorOverlayHtmlAsync({ error, projectRoot, routerRoot: routerRoot() }), { status: 500, headers: { 'Content-Type': 'text/html' } });
    } catch {
      return new Response(`<pre>${String(error?.stack ?? error)}</pre>`, { status: 500, headers: { 'Content-Type': 'text/html' } });
    }
  }

  function routeHandler() {
    if (handler) return handler;
    const appDir = path.join(projectRoot, routerRoot());
    const resolveFile = (file: string) => (path.isAbsolute(file) ? file : path.join(appDir, file));
    const { createRequestHandler } = h.req('expo-server/adapter/bun');
    handler = createRequestHandler(
      { build: projectRoot, environment: 'development' },
      {
        async getRoutesManifest() {
          const manifest = await h.fetchManifest(projectRoot, { ...exp.extra?.router, preserveRedirectAndRewrites: true, appDir });
          // like Expo in development: every HTML route may have a loader (404 data when it has none)
          if (manifest && useServerLoaders()) for (const route of manifest.htmlRoutes) route.loader = `_expo/loaders${route.page}.js`;
          return (
            manifest ?? {
              htmlRoutes: [{ file: 'index.js', page: '/index', routeKeys: {}, namedRegex: /^\/(?:index)?\/?$/i }],
              apiRoutes: [],
              notFoundRoutes: [],
              redirects: [],
              rewrites: [],
            }
          );
        },
        async getHtml(request: Request, route: any) {
          try {
            return await renderHtml(request, route);
          } catch (e) {
            return errorPage(e);
          }
        },
        async getApiRoute(route: any) {
          if (output() !== 'server') console.warn('API routes need `web.output: "server"` in the Expo config');
          try {
            return await loadFunction(resolveFile(route.file));
          } catch (e: any) {
            return new Response(`Failed to load API Route: ${route.file}\n\n${e?.message ?? e}`, { status: 500, headers: { 'Content-Type': 'text/html' } });
          }
        },
        async getMiddleware(route: any) {
          if (!exp.extra?.router?.unstable_useServerMiddleware || output() !== 'server') {
            return { default: () => console.warn('Server middleware needs `unstable_useServerMiddleware` and `web.output: "server"`') };
          }
          return loadFunction(resolveFile(route.file));
        },
        async getLoaderData(request: Request, route: any) {
          if (!useServerLoaders()) return new Response(null, { status: 404 });
          try {
            const loaded = await runLoader(request, route);
            if (!loaded) return new Response(null, { status: 404 });
            if (loaded.value instanceof Response && isSSREnabled()) return loaded.value;
            return Response.json(loaded.value instanceof Response ? await loaded.value.json() : (loaded.value ?? null));
          } catch (e) {
            return errorPage(e);
          }
        },
      }
    );
    return handler!;
  }

  return {
    /** Drop server builds (file change); the Expo config is re-read when it changed. */
    invalidate(changed: string[]) {
      rendering = null;
      functions.clear();
      loaders?.invalidate();
      if (changed.some((f) => /(^|[\\/])(app\.json|app\.config\.[cm]?[jt]s|package\.json)$/.test(f))) {
        exp = getExpoConfig(projectRoot);
        handler = null;
        loaders = null;
      }
    },

    /** Web response for requests the native/bundler routes did not handle, or null. */
    async fetch(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      const accept = request.headers.get('accept') ?? '';
      // public/ folder and the generated favicon (Expo's ServeStaticMiddleware / FaviconMiddleware)
      if (request.method === 'GET' || request.method === 'HEAD') {
        const publicDir = h.getPublicFolderPath(projectRoot);
        const file = path.join(publicDir, decodeURIComponent(url.pathname));
        if (file.startsWith(publicDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return new Response(Bun.file(file));
        if (url.pathname === '/favicon.ico') {
          const favicon = await h.req('@expo/cli/build/src/export/favicon').getFaviconFromExpoConfigAsync(projectRoot, { exp });
          if (favicon) return new Response(favicon.source, { headers: { 'Content-Type': 'image/x-icon' } });
        }
      }
      if (output() === 'single') {
        if (request.method !== 'GET' || !accept.includes('text/html')) return null;
        const html = await h.createTemplateHtmlFromExpoConfigAsync(projectRoot, { exp, scripts: [devBundleUrl()] });
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
      }
      try {
        return await routeHandler()(request);
      } catch (e) {
        return errorPage(e);
      }
    },
  };
}
