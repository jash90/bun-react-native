// Development server for the Bun bundler (replaces the Metro dev server), built on Bun.serve.
//
//   web routes (HTML with SSR, API routes, middleware, public/, favicon) -> ./web-dev.ts (like Expo CLI per web.output)
//   GET  /status                       -> "packager-status:running" (RCTBundleURLProvider)
//   GET  /<entry>.bundle?platform=..   -> dev bundle in Metro module format (./dev-graph.ts)
//   GET  /<entry>.map?platform=..      -> its source map
//   GET  /assets/<dir>/<name>[@Nx].ext -> asset files (best scale fallback)
//   POST /symbolicate                  -> stack frames mapped through the source map (LogBox)
//   WS   /hot                          -> Metro HMR protocol: register-entrypoints, update-start/update/update-done,
//                                         error; device logs are printed here. Drives Fast Refresh on the device.
//   WS   /message                      -> packager messages; {"method":"reload"} when no HMR client is connected
//   /json, /json/list, /json/version, /inspector/*, /open-debugger -> inspector proxy (./inspector.ts)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Server, ServerWebSocket } from 'bun';

import { DevGraph, type HmrUpdate } from './dev-graph';
import { metroHmrClientUrl, reportBuild } from './dev-graph-metro';
import { domComponentHtml, domRoot } from './dom';
import { loadProjectEnv, projectEnvFiles, reloadProjectEnv } from './env';
import { createMessageSocket, messageSocketData, type MessageSocketData } from './message-socket';
import { loadExpoMetroConfig } from './metro-config';
import { createMetroEndpoints } from './metro-endpoints';
import { symbolicateRequest } from './symbolicate';
import { devClientMap } from './sourcemap';
import { createWebDevHandler } from './web-dev';

export interface DevServerOptions {
  projectRoot: string;
  port: number;
  host?: string;
  /** false when Expo CLI (`expo start`, ./expo-dev-server.ts) already loaded the .env files */
  loadEnv?: boolean;
  /** no startup line (Expo CLI prints the server URLs) */
  quiet?: boolean;
  /**
   * Expo CLI's dev-server middleware (manifest for Expo Go / dev clients, `/_expo/*` endpoints), run before the
   * bundler routes; `null` = not handled
   */
  expoMiddleware?: (request: Request) => Promise<Response | null>;
  /** Expo's CORS middleware: response headers to add, or an error for a disallowed cross-origin request */
  cors?: (request: Request) => { headers: Record<string, string>; error?: string };
  /** file events in Metro's watcher shape (Expo typed routes, TypeScript setup) */
  onFileChanges?: (changes: FileChanges) => void;
}

/** Metro file-map change event (`[absolutePath, metadata]` tuples) */
export interface FileChanges {
  addedFiles: [string, object][];
  modifiedFiles: [string, object][];
  removedFiles: [string, object][];
}

type Platform = 'ios' | 'android' | 'web' | 'tvos' | 'macos';

const platformOf = (url: string): Platform => (url.match(/[?&]platform=(android|web|tvos|macos)(&|$)/)?.[1] as Platform) ?? 'ios';
type WsData = { kind: 'hot' | 'message' | 'inspector' | 'devtools-plugins' | 'events'; platform?: Platform; key?: string; clientUrl?: string; message?: MessageSocketData; [k: string]: any };

const IGNORED_DIRS = /(^|[\\/])(node_modules|\.git|ios|android|\.expo|dist|coverage)([\\/]|$)/;

export async function startDevServer(opts: DevServerOptions) {
  const { projectRoot, port } = opts;
  // like `expo start`: development mode, .env files loaded before any bundle (and its transform workers) exists
  if (opts.loadEnv !== false) loadProjectEnv(projectRoot, 'development');
  // the project's Metro config as Expo CLI composes it (symbolicator, and the bundler options read from it)
  const metroConfig = await loadExpoMetroConfig(projectRoot, { isExporting: false });
  const metroEndpoints = createMetroEndpoints(projectRoot, metroConfig.config);
  const envFiles = projectEnvFiles(projectRoot);
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const { FlattenMap, encodedMap } = req('@jridgewell/trace-mapping');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const entryFile = path.relative(projectRoot, req.resolve(pkg.main ?? './index.js', { paths: [projectRoot] }));

  /**
   * one dev graph per platform, plus one per DOM component (`<platform>|dom:<transform.dom>`) and per `dev=false` /
   * `minify=true` bundle (`--no-dev`, `--minify`; Metro keeps a graph per transform options too)
   */
  const graphs = new Map<string, DevGraph>();
  const lastBundleUrl = new Map<string, string>();
  const keyOf = (u: URL | string) => {
    const url = typeof u === 'string' ? new URL(u, 'http://localhost') : u;
    const dom = url.searchParams.get('transform.dom');
    const mode = (url.searchParams.get('dev') === 'false' ? '|nodev' : '') + (url.searchParams.get('minify') === 'true' ? '|minify' : '');
    return platformOf(url.toString()) + mode + (dom ? `|dom:${dom}` : '');
  };
  const platformOfKey = (key: string) => key.split('|')[0] as Platform;
  const hotClients = new Set<ServerWebSocket<WsData>>();
  const messages = createMessageSocket<WsData>();
  const mapCache = new Map<string, { raw: any; flat: any; trace: any; graph: DevGraph }>();
  /** lazy bundles (`modulesOnly=true`): source maps by `<platform> <pathname>` */
  const lazyMaps = new Map<string, { raw: any; flat: any; trace: any; graph: DevGraph }>();
  const lazyKey = (u: URL) => `${keyOf(u)} ${u.pathname.replace(/\.(bundle|map)$/, '')}`;

  /** `/<path>.bundle?modulesOnly=true`: the lazy bundle of the file at <path> (Metro async import) */
  async function serializeLazy(url: URL) {
    const g = graph(keyOf(url));
    const rel = decodeURIComponent(url.pathname.replace(/^\//, '').replace(/\.(bundle|map)$/, ''));
    const r = g.project.resolver.resolve('./' + rel, path.join(projectRoot, 'package.json'), false);
    if (r.type !== 'sourceFile') throw new Error(`Cannot resolve lazy bundle ${url.pathname}`);
    const bundleUrl = new URL(url);
    bundleUrl.pathname = url.pathname.replace(/\.map$/, '.bundle');
    const mapUrl = new URL(bundleUrl);
    mapUrl.pathname = bundleUrl.pathname.replace(/\.bundle$/, '.map');
    const result = await reportBuild(metroConfig.reporter, nextBuildID(), bundleDetails(url, r.filePath), false, (p) => g.setProgress(p), () => g.serializeLazy(r.filePath, bundleUrl.toString(), mapUrl.toString()));
    // native: Metro's own served map (sourceMapString); symbolication reads the same map
    lazyMaps.set(lazyKey(url), result.metro ? { raw: result.map, flat: result.map, trace: new FlattenMap(result.map), graph: g } : { raw: result.map, flat: null, trace: null, graph: g });
    return result.code;
  }
  /** the served map: Metro's shape (absolute sources, function maps, ignore list); symbolication uses `trace` */
  const clientMap = (flat: any, g: DevGraph) => devClientMap(flat, { projectRoot, projectRequire: req, functionMapOf: (f) => g.functionMapOf(f) });

  function flatLazyMap(key: string) {
    const entry = lazyMaps.get(key);
    if (entry && !entry.trace) {
      entry.trace = new FlattenMap(entry.raw);
      entry.flat = clientMap(encodedMap(entry.trace), entry.graph);
    }
    return entry ?? null;
  }
  let revision = 0;

  const graph = (key: string) => {
    let g = graphs.get(key);
    if (!g) {
      const dom = key.includes('|dom:') ? key.slice(key.indexOf('|dom:') + 5) : undefined;
      // DOM components: a web bundle of expo/dom/entry.js that registers the component (transform option `dom`)
      const entry = dom ? path.relative(projectRoot, req.resolve('expo/dom/entry.js')) : entryFile;
      g = new DevGraph({ projectRoot, platform: platformOfKey(key), entryFile: entry, dom, dev: !key.includes('|nodev'), minify: key.includes('|minify') });
      graphs.set(key, g);
    }
    return g;
  };

  // one serialization per platform at a time (bundle + parallel source map requests share it)
  const inflight = new Map<string, Promise<string>>();
  function serialize(url: URL): Promise<string> {
    const key = keyOf(url);
    let p = inflight.get(key);
    if (!p) {
      p = serializeNow(key, url).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

  // metro/Server: build numbers (base 36 build ids) and the bundle details its reporter events carry
  let buildNumber = 0;
  const nextBuildID = () => (buildNumber++).toString(36);
  function bundleDetails(url: URL, entryFile: string) {
    const q = url.searchParams;
    return {
      bundleType: 'bundle',
      customResolverOptions: req('metro/private/lib/parseCustomResolverOptions').default(q),
      customTransformOptions: req('metro/private/lib/parseCustomTransformOptions').default(q),
      dev: q.get('dev') !== 'false',
      entryFile,
      minify: q.get('minify') === 'true',
      platform: q.get('platform'),
    };
  }

  async function serializeNow(key: string, url: URL) {
    const g = graph(key);
    const mapUrl = new URL(url);
    mapUrl.pathname = url.pathname.replace(/\.bundle$/, '.map');
    // Expo's terminal reporter prints `iOS Bundled 123ms node_modules/expo-router/entry.js (1234 modules)`
    const result = await reportBuild(metroConfig.reporter, nextBuildID(), bundleDetails(url, g.entryPath), false, (p) => g.setProgress(p), () => g.serialize(url.toString(), mapUrl.toString()));
    mapCache.delete(key);
    mapCache.set(key, result.metro ? { raw: result.map, flat: result.map, trace: new FlattenMap(result.map), graph: g } : { raw: result.map, flat: null, trace: null, graph: g });
    lastBundleUrl.set(key, url.toString());
    return result.code;
  }

  function flatMap(key: string) {
    const entry = mapCache.get(key);
    if (!entry) return null;
    if (!entry.trace) {
      entry.trace = new FlattenMap(entry.raw);
      entry.flat = clientMap(encodedMap(entry.trace), entry.graph);
    }
    return entry;
  }

  // ---- HMR
  function sendHot(key: string, msg: object) {
    const data = JSON.stringify(msg);
    let sent = 0;
    for (const ws of hotClients) {
      if (ws.data.key === key) {
        ws.send(data);
        sent++;
      }
    }
    return sent;
  }

  const web = createWebDevHandler({ projectRoot, port, broadcast: (method, params) => messages.broadcast(method, params) });

  async function onFilesChanged(files: string[]) {
    // Expo watchEnvironmentVariables: a changed .env file reloads the variables (dev bundles read them on serialization)
    if (files.some((f) => envFiles.includes(f))) reloadProjectEnv(projectRoot);
    web.invalidate(files);
    for (const [key, g] of graphs) {
      const platform = platformOfKey(key);
      const base = lastBundleUrl.get(key);
      const urlFor = (ext: string) => (name: string) => {
        const u = new URL(base ?? `http://localhost:${port}/index.bundle?platform=${platform}&dev=true`);
        u.pathname = '/' + name.replace(/\.[^./]+$/, '') + ext;
        return u.toString();
      };
      let update: HmrUpdate | null;
      try {
        const clientUrl = [...hotClients].find((ws) => ws.data.key === key && ws.data.clientUrl)?.data.clientUrl;
        update = await g.update(files, { bundleUrl: urlFor('.bundle'), mapUrl: urlFor('.map'), clientUrl });
      } catch (e: any) {
        const message = String(e?.message ?? e);
        console.error(message);
        sendHot(key, { type: 'error', body: { type: 'TransformError', message, errors: [{ description: message }] } });
        continue;
      }
      if (!update) continue;
      mapCache.delete(key); // positions of modified modules changed; rebuilt on next bundle/map request
      for (const k of lazyMaps.keys()) if (k.startsWith(key + ' ')) lazyMaps.delete(k);
      const sent = sendHot(key, { type: 'update-start', body: { isInitialUpdate: false } });
      if (sent) {
        // metro/HmrServer message shapes (IncrementalBundler revision ids, DeltaCalculator change ids); like Metro,
        // nothing is printed for an update
        sendHot(key, { type: 'update', body: { revisionId: g.isMetro ? crypto.randomBytes(8).toString('hex') : String(++revision), isInitialUpdate: false, ...update } });
        sendHot(key, { type: 'update-done', body: { changeId: crypto.randomUUID() } });
      } else {
        // no Fast Refresh client: reload the app instead
        messages.broadcast('reload');
      }
    }
  }

  // ---- file watching (fs.watch also reports reads/no-op events: react to new mtime/size only)
  const seen = new Map<string, string>();
  const pending = new Map<string, 'add' | 'change' | 'delete'>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const changed = (rel: string): 'add' | 'change' | 'delete' | null => {
    try {
      const st = fs.statSync(path.join(projectRoot, rel));
      if (!st.isFile()) return null;
      const sig = `${st.mtimeMs}:${st.size}`;
      const prev = seen.get(rel);
      seen.set(rel, sig);
      if (prev !== undefined) return prev !== sig ? 'change' : null;
      if (Date.now() - st.birthtimeMs < 2000) return 'add';
      return Date.now() - st.mtimeMs < 2000 ? 'change' : null;
    } catch {
      return seen.delete(rel) || true ? 'delete' : null;
    }
  };
  fs.watch(projectRoot, { recursive: true }, (_event, filename) => {
    if (!filename || IGNORED_DIRS.test(String(filename))) return;
    const kind = changed(String(filename));
    if (!kind) return;
    pending.set(path.join(projectRoot, String(filename)), kind);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const events = [...pending];
      pending.clear();
      if (opts.onFileChanges) {
        const of = (k: string) => events.filter(([, kind]) => kind === k).map(([f]): [string, object] => [f, { type: 'f' }]);
        opts.onFileChanges({ addedFiles: of('add'), modifiedFiles: of('change'), removedFiles: of('delete') });
      }
      onFilesChanged(events.map(([f]) => f)).catch((e) => console.error(e));
    }, 30);
  });
  /** `/expo-dev-plugins/broadcast`: Expo DevTools plugins relay (every message goes to the other clients) */
  const devtoolsPluginClients = new Set<ServerWebSocket<WsData>>();

  const { inspector } = await import('./inspector').then((m) => ({ inspector: m.createInspectorProxy({ projectRoot, port }) }));

  /** the bundler's own routes (after Expo's middleware) */
  async function route(request: Request, srv: Server<WsData>): Promise<Response | undefined> {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    const platform = (searchParams.get('platform') ?? 'ios') as Platform;

    // `/events`: accepted and silent, like Expo CLI's (its events socket never registers connections,
    // createEventSocket.js)
    if (pathname === '/hot' || pathname === '/message' || pathname === '/events' || pathname === '/expo-dev-plugins/broadcast') {
      const kind = pathname === '/expo-dev-plugins/broadcast' ? 'devtools-plugins' : (pathname.slice(1) as 'hot' | 'message' | 'events');
      const message = kind === 'message' ? messageSocketData(request, srv.requestIP(request)?.address, `http://localhost:${port}`) : undefined;
      if (srv.upgrade(request, { data: { kind, message } })) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    if (opts.expoMiddleware) {
      const expoResponse = await opts.expoMiddleware(request);
      if (expoResponse) return expoResponse;
    }
    const inspectorResponse = await inspector.fetch(request, srv);
    if (inspectorResponse !== null) return inspectorResponse;

    // Expo createMetroStatusMiddleware
    if (pathname === '/status') return new Response('packager-status:running', { headers: { 'X-React-Native-Project-Root': encodeURI(metroConfig.config.projectRoot) } });
    if (pathname.endsWith('.bundle')) {
      try {
        const code = searchParams.get('modulesOnly') === 'true' ? await serializeLazy(url) : await serialize(url);
        return new Response(code, { headers: { 'Content-Type': 'application/javascript; charset=UTF-8' } });
      } catch (e: any) {
        // printed by the reporter (bundling_error)
        const message = String(e?.message ?? e);
        return Response.json({ type: 'TransformError', message, errors: [{ description: message }] }, { status: 500 });
      }
    }
    if (pathname.endsWith('.map')) {
      if (searchParams.get('modulesOnly') === 'true') {
        if (!lazyMaps.has(lazyKey(url))) await serializeLazy(url);
        return Response.json(flatLazyMap(lazyKey(url))!.flat);
      }
      const bundleUrl = new URL(url.toString().replace(/\.map(\?|$)/, '.bundle$1'));
      if (!mapCache.has(keyOf(url))) await serialize(bundleUrl);
      return Response.json(flatMap(keyOf(url))!.flat);
    }
    if (metroEndpoints.isAssetRequest(pathname)) return metroEndpoints.asset(request);
    const source = metroEndpoints.source(pathname);
    if (source) return source;
    if (pathname === '/symbolicate' && request.method === 'POST') {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {}
      const mapsFor = (file: string) => {
        const entry = /[?&]modulesOnly=true/.test(file) ? flatLazyMap(lazyKey(new URL(file))) : mapCache.has(keyOf(file)) ? flatMap(keyOf(file)) : null;
        return entry ? { trace: entry.trace, served: entry.flat } : null;
      };
      const isGraphFile = (file: string) => [...graphs.values()].some((g) => g.hasModule(file));
      const result = await symbolicateRequest(body, { projectRoot, mapsFor, isGraphFile, symbolicator: metroConfig.config.symbolicator ?? {} });
      return Response.json(result.body, { status: result.status });
    }
    if (pathname.startsWith('/_expo/@dom')) {
      // Expo DomComponentsMiddleware: the HTML the native WebView loads for a `"use dom"` component
      const file = searchParams.get('file');
      if (!file || !file.startsWith('file://')) return new Response(`Invalid file path: ${file}`, { status: 400 });
      const { virtualEntry, dom } = domRoot(projectRoot, file);
      const bundle = new URL(`/${path.relative(projectRoot, virtualEntry).replace(/\.js$/, '')}.bundle`, `http://${request.headers.get('host')}`);
      for (const [k, v] of Object.entries({ platform: 'web', dev: 'true', hot: 'false', lazy: 'true', 'transform.dom': dom, 'transform.engine': 'hermes' })) bundle.searchParams.set(k, v);
      return new Response(domComponentHtml(projectRoot, bundle.toString(), path.basename(file)), { headers: { 'Content-Type': 'text/html' } });
    }
    const webResponse = await web.fetch(request);
    if (webResponse) return webResponse;
    return new Response('Not found', { status: 404 });
  }

  const server: Server<WsData> = Bun.serve<WsData, any>({
    port,
    hostname: opts.host ?? '0.0.0.0',
    idleTimeout: 0,
    async fetch(request, srv) {
      // clients that send no Host header (e.g. React Native's packager status check) get a relative request URL
      if (!/^https?:/.test(request.url)) request = new Request(new URL(request.url, `http://localhost:${port}`), request);
      // Expo's CORS middleware first: cross-origin requests from foreign sites are rejected like in Metro
      const cors = opts.cors?.(request);
      if (cors?.error) return new Response(cors.error, { status: 500 });
      let response = await route(request, srv);
      if (!response) return undefined as any; // websocket upgrade
      if (cors) for (const [k, v] of Object.entries(cors.headers)) if (!response.headers.has(k)) response.headers.set(k, v);
      // Expo's Metro middleware stack: no-cache headers on every response, compression of bundles and maps
      for (const [k, v] of NO_CACHE_HEADERS) if (!response.headers.has(k)) response.headers.set(k, v);
      if (/\.(bundle|map)$/.test(new URL(request.url).pathname)) response = await compress(request, response, req);
      return response;
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === 'message') messages.open(ws);
        else if (ws.data.kind === 'devtools-plugins') devtoolsPluginClients.add(ws);
        else if (ws.data.kind === 'inspector') inspector.websocket.open(ws);
      },
      close(ws) {
        hotClients.delete(ws);
        devtoolsPluginClients.delete(ws);
        if (ws.data.kind === 'message') messages.close(ws);
        if (ws.data.kind === 'inspector') inspector.websocket.close(ws);
      },
      message(ws, raw) {
        if (ws.data.kind === 'inspector') return inspector.websocket.message(ws, raw);
        if (ws.data.kind === 'message') return messages.message(ws, raw);
        if (ws.data.kind === 'devtools-plugins') {
          for (const client of devtoolsPluginClients) if (client !== ws) client.send(raw);
          return;
        }
        if (ws.data.kind !== 'hot') return;
        let msg: any;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.type === 'register-entrypoints') {
          const entry = String(msg.entryPoints?.[0] ?? '');
          ws.data.platform = platformOf(entry);
          ws.data.key = keyOf(entry);
          hotClients.add(ws);
          if (graph(ws.data.key).isMetro) {
            // metro/HmrServer: an initial update (pending changes, usually none), then bundle-registered
            ws.data.clientUrl = metroHmrClientUrl(entry);
            ws.send(JSON.stringify({ type: 'update-start', body: { isInitialUpdate: true } }));
            ws.send(JSON.stringify({ type: 'update', body: { revisionId: crypto.randomBytes(8).toString('hex'), isInitialUpdate: true, added: [], modified: [], deleted: [] } }));
            ws.send(JSON.stringify({ type: 'update-done', body: {} }));
          }
          ws.send(JSON.stringify({ type: 'bundle-registered' }));
        } else if (msg.type === 'log') {
          // metro/HmrServer: client logs go to the reporter (Expo prints them with level badges)
          if (metroConfig.config.server.forwardClientLogs) metroConfig.reporter.update({ type: 'client_log', level: msg.level, data: msg.data, mode: msg.mode });
        }
      },
    },
  });

  if (!opts.quiet) console.log(`Bun dev server listening on http://localhost:${server.port}`);
  return { server, port: server.port as number, broadcast: messages.broadcast };
}

// ---------------------------------------------------------------- Expo/Metro response headers

/** Expo createMetroMiddleware noCacheMiddleware */
const NO_CACHE_HEADERS: [string, string][] = [
  ['Surrogate-Control', 'no-store'],
  ['Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'],
  ['Pragma', 'no-cache'],
  ['Expires', '0'],
];

/**
 * Expo's compression middleware for `.bundle` / `.map` (npm `compression` defaults: br > gzip > deflate by
 * Accept-Encoding via `negotiator`, threshold 1 KiB).
 */
async function compress(request: Request, response: Response, req: NodeRequire): Promise<Response> {
  if (response.headers.has('Content-Encoding') || !response.body) return response;
  const body = Buffer.from(await response.arrayBuffer());
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Accept-Encoding');
  const Negotiator = req(req.resolve('negotiator', { paths: [req.resolve('compression', { paths: [req.resolve('@expo/cli/package.json')] })] }));
  const accept = request.headers.get('accept-encoding');
  const method = accept ? new Negotiator({ headers: { 'accept-encoding': accept } }).encoding(['br', 'gzip', 'deflate', 'identity'], ['br', 'gzip']) : 'identity';
  if (body.length < 1024 || !method || method === 'identity') return new Response(body, { status: response.status, headers });
  const zlib = await import('node:zlib');
  const out = method === 'br' ? zlib.brotliCompressSync(body) : method === 'gzip' ? zlib.gzipSync(body) : zlib.deflateSync(body);
  headers.set('Content-Encoding', method);
  headers.delete('Content-Length');
  return new Response(out, { status: response.status, headers });
}

// ---------------------------------------------------------------- assets

// ---------------------------------------------------------------- symbolication

