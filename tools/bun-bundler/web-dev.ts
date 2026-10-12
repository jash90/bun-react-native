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
import { buildWeb, cssHmrId, md5 } from './web';
import { buildServerFunction, importServerBundle } from './web-export';

export function createWebDevHandler(opts: { projectRoot: string; port: number }) {
  const { projectRoot } = opts;
  const h = expoHelpers(projectRoot);
  let exp = getExpoConfig(projectRoot);
  let rendering: Promise<{ render: any; css: { originFilename: string; css: string }[] }> | null = null;
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

  async function renderHtml(request: Request) {
    const { render, css } = await loadRender();
    const location = new URL(request.url);
    const template = await render.getStaticContent(new URL(location.pathname + location.search, `http://localhost:${opts.port}`));
    const resources = css.map(({ originFilename, css }) => ({
      type: 'css',
      originFilename,
      filename: originFilename,
      source: css,
      metadata: { hmrId: cssHmrId(originFilename) },
    }));
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
        async getHtml(request: Request) {
          try {
            return await renderHtml(request);
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
        async getLoaderData() {
          return new Response(null, { status: 404 });
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
      if (changed.some((f) => /(^|[\\/])(app\.json|app\.config\.[cm]?[jt]s|package\.json)$/.test(f))) {
        exp = getExpoConfig(projectRoot);
        handler = null;
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
