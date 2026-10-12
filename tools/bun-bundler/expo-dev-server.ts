// `bun run start` = Expo CLI's own `expo start` with the Bun dev server in place of Metro.
//
// Expo's DevServerManager creates the `metro` bundler dev server through
// `require('./metro/MetroBundlerDevServer').MetroBundlerDevServer`; that module is replaced (require.cache) by
// BunBundlerDevServer, a subclass of Expo's BundlerDevServer. Everything else is Expo CLI unchanged: argument parsing
// and help, `.env` loading, ports, URL creation (lan/localhost/tunnel), the terminal UI with QR code and key
// commands (s, a, i, w, r, j, m, shift+m, o, c, ?), opening Expo Go or a development build on a simulator / emulator,
// Bonjour / development sessions, dependency checks, TypeScript setup and typed routes.
//
// BunBundlerDevServer runs Expo's dev-server middleware (manifest for Expo Go and dev clients, interstitial page,
// deep-link redirect, DevTools plugins, open endpoint, `_expo/touch`, error-overlay meta, JS inspector) on an
// internal `node:http` + `connect` server, and the Bun dev server (./dev-server.ts) forwards those paths to it.
// Metro's file watcher contract (typed routes, TypeScript detection) is served from the Bun dev server's watcher.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

import { startDevServer } from './dev-server';
import { usesMetroEngine } from './metro-config-support';
import { loadExpoMetroConfig } from './metro-config';

const MANIFEST_PATHS = ['/', '/manifest', '/index.exp'];
const EXPO_PATH_PREFIXES = ['/open-stack-frame', '/_expo/loading', '/_expo/link', '/_expo/plugins', '/_expo/open', '/_expo/touch', '/_expo/error-overlay-meta', '/_expo/debugger'];
const NOT_HANDLED = 'x-bun-bundler-next';

export function installBunBundlerDevServer(projectRoot: string) {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  // React Server Components and metro.config.js customizations the Bun bundler does not honour keep Metro
  if (usesMetroEngine(projectRoot, 'expo start')) return null;
  const cli = (m: string) => req(`@expo/cli/build/src/${m}`);
  const { BundlerDevServer } = cli('start/server/BundlerDevServer');
  const connect = req(req.resolve('connect', { paths: [req.resolve('@expo/cli/package.json')] }));

  class BunBundlerDevServer extends BundlerDevServer {
    /** Metro-shaped facade: `getBundler().getBundler().getWatcher()` for Expo's watchers (typed routes) */
    metro: any = null;

    get name() {
      // Expo selects the native/web dev server, the JS inspector and TypeScript services by this name
      return 'metro';
    }

    async resolvePortAsync(options: any = {}) {
      return options.port ?? (options.devClient ? Number(process.env.RCT_METRO_PORT) || 8081 : await cli('utils/port').getFreePortAsync(8081));
    }

    async startImplementationAsync(options: any) {
      options.port = await this.resolvePortAsync(options);
      await this.initUrlCreator(options);
      const { exp } = req('@expo/config').getConfig(projectRoot, { skipSDKVersionRequirement: true });
      if (options.resetDevServer) fs.rmSync(path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler'), { recursive: true, force: true });
      const serverBaseUrl = `http://localhost:${options.port}`;
      process.env.EXPO_DEV_SERVER_ORIGIN = serverBaseUrl;

      const { config: metroConfig } = await loadExpoMetroConfig(projectRoot, { isExporting: false, maxWorkers: options.maxWorkers });
      const app = this.createExpoMiddleware(options, exp, serverBaseUrl, metroConfig);
      const internal = http.createServer(app);
      await new Promise<void>((resolve) => internal.listen(0, '127.0.0.1', resolve));
      const internalPort = (internal.address() as any).port;

      const watcher = new EventEmitter();
      this.metro = { getBundler: () => ({ getBundler: () => ({ getWatcher: () => watcher }) }) };
      const cors = cli('start/server/middleware/CorsMiddleware').createCorsMiddleware(exp);
      const dev = await startDevServer({
        projectRoot,
        port: options.port,
        host: options.location?.hostType === 'localhost' ? 'localhost' : undefined,
        loadEnv: false,
        quiet: true,
        expoMiddleware: (request) => forward(request, internalPort),
        cors: (request) => runCors(cors, request),
        onFileChanges: (changes) => watcher.emit('change', { changes }),
      });

      const closing = new EventEmitter();
      const server = {
        close: (callback?: (err?: Error) => void) => {
          dev.server.stop(true);
          internal.close();
          closing.emit('close');
          this.instance = null;
          this.metro = null;
          callback?.();
        },
        addListener: (event: string, fn: () => void) => closing.on(event, fn),
        removeListener: (event: string, fn: () => void) => closing.off(event, fn),
      };
      return {
        server,
        location: { port: options.port, host: 'localhost', url: serverBaseUrl, protocol: 'http' },
        middleware: app,
        messageSocket: { broadcast: dev.broadcast },
      };
    }

    /** the middleware MetroBundlerDevServer adds (in its order), minus what the Bun dev server serves itself */
    createExpoMiddleware(options: any, exp: any, serverBaseUrl: string, metroConfig: any) {
      const app = connect();
      // Expo's base Metro middleware: `/open-stack-frame` (open a LogBox frame in the editor, file inside the server
      // root, throttled); its `/status` is served by the Bun dev server
      app.use(cli('start/server/metro/dev-server/createMetroMiddleware').createMetroMiddleware(metroConfig, { serverBaseUrl, getMetroBundler: () => ({ ready: async () => {} }) }).middleware);
      const routerRoot = cli('start/server/metro/router').getRouterDirectoryModuleIdWithManifest(projectRoot, exp);
      const mw = (name: string) => cli(`start/server/middleware/${name}`);
      let manifest: any;
      app.use(async (rq: any, rs: any, next: any) => {
        manifest ??= (await this.getManifestMiddlewareAsync(options)).getHandler();
        manifest(rq, rs, next);
      });
      app.use(new (mw('InterstitialPageMiddleware').InterstitialPageMiddleware)(projectRoot, { scheme: options.location?.scheme ?? null }).getHandler());
      app.use(new (mw('DevToolsPluginMiddleware').DevToolsPluginMiddleware)(projectRoot, this.devToolsPluginManager).getHandler());
      app.use(
        new (mw('RuntimeRedirectMiddleware').RuntimeRedirectMiddleware)(projectRoot, {
          getLocation: ({ runtime }: { runtime: string }) => (runtime === 'custom' ? this.urlCreator?.constructDevClientUrl() : this.urlCreator?.constructUrl({ scheme: 'exp' })),
        }).getHandler()
      );
      const { createInfoHandler, createOpen } = mw('openHandlers');
      app.use(
        new (mw('OpenMiddleware').OpenMiddleware)(projectRoot, {
          serverBaseUrl,
          getHostSupport: (platform: string) =>
            platform === 'ios' && process.platform !== 'darwin'
              ? { canOpen: false, reason: `iOS simulators require macOS with Xcode installed; this dev server is running on ${process.platform}.` }
              : { canOpen: true },
          getInfo: createInfoHandler({
            urlCreator: this.getUrlCreator(),
            getIsDevClient: () => this.isDevClient,
            getIsRedirectPageEnabled: () => this.isRedirectPageEnabled(),
            getAppId: async (platform: string) => {
              if (platform === 'web') return null;
              const Resolver =
                platform === 'ios' ? cli('start/platforms/ios/AppleAppIdResolver').AppleAppIdResolver : cli('start/platforms/android/AndroidAppIdResolver').AndroidAppIdResolver;
              return new Resolver(projectRoot).getAppIdAsync().catch(() => null);
            },
          }),
          open: createOpen({ getIsDevClient: () => this.isDevClient, openPlatformAsync: (target: string, resolver: any) => this.openPlatformAsync(target, resolver) }),
        }).getHandler()
      );
      const serverRoot = req('@expo/config/paths').getMetroServerRoot(projectRoot);
      app.use(new (mw('CreateFileMiddleware').CreateFileMiddleware)({ metroRoot: serverRoot, projectRoot, appDir: path.join(projectRoot, routerRoot) }).getHandler());
      app.use((rq: any, rs: any, next: any) => {
        // used by @expo/log-box
        if (!rq.url?.startsWith('/_expo/error-overlay-meta')) return next();
        rs.statusCode = 200;
        rs.setHeader('Content-Type', 'application/json');
        rs.end(JSON.stringify({ projectRoot, serverRoot, sdkVersion: exp.sdkVersion }));
      });
      app.use('/_expo/debugger', mw('inspector/createJsInspectorMiddleware').createJsInspectorMiddleware({ serverBaseUrl }));
      app.use((_rq: any, rs: any) => {
        rs.statusCode = 404;
        rs.setHeader(NOT_HANDLED, '1');
        rs.end();
      });
      return app;
    }

    async waitForTypeScriptAsync() {
      if (!this.instance || !this.metro) return false;
      return new Promise<boolean>((resolve) => {
        const off = cli('start/server/metro/metroWatchTypeScriptFiles').metroWatchTypeScriptFiles({
          projectRoot,
          server: this.instance.server,
          metro: this.metro,
          tsconfig: true,
          throttle: true,
          eventTypes: ['change', 'add'],
          callback: async () => {
            off();
            const { TypeScriptProjectPrerequisite } = cli('start/doctor/typescript/TypeScriptProjectPrerequisite');
            try {
              await new TypeScriptProjectPrerequisite(projectRoot).bootstrapAsync();
              resolve(true);
            } catch (error) {
              cli('log').Log.exception(error);
              resolve(false);
            }
          },
        });
      });
    }

    async startTypeScriptServices() {
      return cli('start/server/type-generation/startTypescriptTypeGeneration').startTypescriptTypeGenerationAsync({
        server: this.instance?.server,
        metro: this.metro,
        projectRoot,
      });
    }

    getConfigModuleIds() {
      return ['./metro.config.js', './metro.config.json', './rn-cli.config.js'];
    }

    async watchEnvironmentVariables() {
      // the Bun dev server re-reads the .env files when one changes (./env.ts)
    }
  }

  const target = req.resolve('@expo/cli/build/src/start/server/metro/MetroBundlerDevServer');
  (require.cache as any)[target] = { id: target, filename: target, loaded: true, exports: { MetroBundlerDevServer: BunBundlerDevServer } };
  return BunBundlerDevServer;
}

/** Forward a request to Expo's middleware; `null` when none of them handles it. */
async function forward(request: Request, internalPort: number): Promise<Response | null> {
  const url = new URL(request.url);
  const p = url.pathname;
  if (!MANIFEST_PATHS.includes(p) && !EXPO_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'))) return null;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const res = await fetch(`http://127.0.0.1:${internalPort}${p}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });
  if (res.headers.get(NOT_HANDLED)) return null;
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(res.body, { status: res.status, headers });
}

/** Expo's CORS middleware applied to a fetch Request: headers to add, or the error it would raise. */
function runCors(middleware: (rq: any, rs: any, next: (err?: Error) => void) => void, request: Request) {
  const headers: Record<string, string> = {};
  let error: string | undefined;
  const rq = { headers: Object.fromEntries(request.headers), url: new URL(request.url, 'http://localhost').pathname, method: request.method };
  const rs = {
    setHeader: (k: string, v: string) => void (headers[k] = v),
    getHeader: (k: string) => headers[k],
    removeHeader: (k: string) => void delete headers[k],
  };
  middleware(rq, rs, (err?: Error) => void (error = err?.message));
  return { headers, error };
}
