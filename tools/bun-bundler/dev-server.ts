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
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Server, ServerWebSocket } from 'bun';

import { getAssetRecord } from './assets';
import { DevGraph, type HmrUpdate } from './dev-graph';
import { domComponentHtml, domRoot } from './dom';
import { loadProjectEnv, projectEnvFiles, reloadProjectEnv } from './env';
import { createMessageSocket, messageSocketData, type MessageSocketData } from './message-socket';
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

const PLATFORM_LABEL: Record<Platform, string> = { ios: 'iOS', android: 'Android', web: 'Web', tvos: 'tvOS', macos: 'macOS' };
const platformOf = (url: string): Platform => (url.match(/[?&]platform=(android|web|tvos|macos)(&|$)/)?.[1] as Platform) ?? 'ios';
type WsData = { kind: 'hot' | 'message' | 'inspector' | 'devtools-plugins'; platform?: Platform; key?: string; message?: MessageSocketData; [k: string]: any };

const IGNORED_DIRS = /(^|[\\/])(node_modules|\.git|ios|android|\.expo|dist|coverage)([\\/]|$)/;

export async function startDevServer(opts: DevServerOptions) {
  const { projectRoot, port } = opts;
  // like `expo start`: development mode, .env files loaded before any bundle (and its transform workers) exists
  if (opts.loadEnv !== false) loadProjectEnv(projectRoot, 'development');
  const envFiles = projectEnvFiles(projectRoot);
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const { TraceMap, FlattenMap, originalPositionFor, encodedMap } = req('@jridgewell/trace-mapping');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const entryFile = path.relative(projectRoot, req.resolve(pkg.main ?? './index.js', { paths: [projectRoot] }));

  /** one dev graph per platform, plus one per DOM component (`<platform>|dom:<transform.dom>`) */
  const graphs = new Map<string, DevGraph>();
  const lastBundleUrl = new Map<string, string>();
  const keyOf = (u: URL | string) => {
    const url = typeof u === 'string' ? new URL(u, 'http://localhost') : u;
    const dom = url.searchParams.get('transform.dom');
    return platformOf(url.toString()) + (dom ? `|dom:${dom}` : '');
  };
  const platformOfKey = (key: string) => key.split('|')[0] as Platform;
  const labelOf = (key: string) => PLATFORM_LABEL[platformOfKey(key)] + (key.includes('|dom:') ? ' DOM component' : '');
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
    const result = await g.serializeLazy(r.filePath, bundleUrl.toString(), mapUrl.toString());
    lazyMaps.set(lazyKey(url), { raw: result.map, flat: null, trace: null, graph: g });
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
      g = new DevGraph({ projectRoot, platform: platformOfKey(key), entryFile: entry, dom });
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

  async function serializeNow(key: string, url: URL) {
    const g = graph(key);
    const t0 = performance.now();
    const fresh = !g.built;
    const mapUrl = new URL(url);
    mapUrl.pathname = url.pathname.replace(/\.bundle$/, '.map');
    const result = await g.serialize(url.toString(), mapUrl.toString());
    mapCache.delete(key);
    mapCache.set(key, { raw: result.map, flat: null, trace: null, graph: g });
    lastBundleUrl.set(key, url.toString());
    const { cacheHits, transformed } = g.project.stats;
    console.log(
      `${labelOf(key)} Bundled ${Math.round(performance.now() - t0)}ms with Bun` +
        (fresh ? ` (${transformed} transformed, ${cacheHits} from cache)` : '')
    );
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

  const web = createWebDevHandler({ projectRoot, port });

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
        update = await g.update(files, { bundleUrl: urlFor('.bundle'), mapUrl: urlFor('.map') });
      } catch (e: any) {
        const message = String(e?.message ?? e);
        console.error(message);
        sendHot(key, { type: 'error', body: { type: 'TransformError', message, errors: [{ description: message }] } });
        continue;
      }
      if (!update) continue;
      mapCache.delete(key); // positions of modified modules changed; rebuilt on next bundle/map request
      for (const k of lazyMaps.keys()) if (k.startsWith(key + ' ')) lazyMaps.delete(k);
      const names = [...update.modified, ...update.added].map((m) => g.nameOf(m.module[0]));
      const sent = sendHot(key, { type: 'update-start', body: { isInitialUpdate: false } });
      if (sent) {
        sendHot(key, { type: 'update', body: { ...update, revisionId: String(++revision), isInitialUpdate: false } });
        sendHot(key, { type: 'update-done' });
        console.log(`[HMR ${labelOf(key).toLowerCase().replace(' dom component', ' dom')}] ${names.join(', ')}`);
      } else {
        // no Fast Refresh client: reload the app instead
        messages.broadcast('reload');
        console.log(`[reload ${platform}] ${names.join(', ')}`);
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

    if (pathname === '/hot' || pathname === '/message' || pathname === '/expo-dev-plugins/broadcast') {
      const kind = pathname === '/expo-dev-plugins/broadcast' ? 'devtools-plugins' : (pathname.slice(1) as 'hot' | 'message');
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

    if (pathname === '/status') return new Response('packager-status:running');
    if (pathname.endsWith('.bundle')) {
      try {
        const code = searchParams.get('modulesOnly') === 'true' ? await serializeLazy(url) : await serialize(url);
        return new Response(code, { headers: { 'Content-Type': 'application/javascript; charset=UTF-8' } });
      } catch (e: any) {
        const message = String(e?.message ?? e);
        console.error(message);
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
    if (pathname.startsWith('/assets/')) return serveAsset(projectRoot, pathname, searchParams.get('platform') ?? 'web');
    if (pathname === '/symbolicate' && request.method === 'POST') {
      const body = await request.json();
      const traceFor = (file: string) => {
        if (/[?&]modulesOnly=true/.test(file)) return flatLazyMap(lazyKey(new URL(file)))?.trace ?? null;
        const key = keyOf(file);
        return mapCache.has(key) ? flatMap(key)!.trace : null;
      };
      return Response.json(symbolicate(projectRoot, body.stack ?? [], traceFor, originalPositionFor));
    }
    if (pathname === '/open-stack-frame' || pathname === '/open-url') return new Response('');
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
      const response = await route(request, srv);
      if (response && cors) for (const [k, v] of Object.entries(cors.headers)) if (!response.headers.has(k)) response.headers.set(k, v);
      return response as Response;
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
          ws.send(JSON.stringify({ type: 'bundle-registered' }));
        } else if (msg.type === 'log') {
          console.log(`[${ws.data.platform ?? 'app'} ${msg.level ?? 'log'}]`, ...(msg.data ?? []));
        }
      },
    },
  });

  if (!opts.quiet) console.log(`Bun dev server listening on http://localhost:${server.port}`);
  return { server, port: server.port as number, broadcast: messages.broadcast };
}

// ---------------------------------------------------------------- assets

/** metro/src/Assets.js getAsset: the first file of the asset record with at least the requested scale. */
function serveAsset(projectRoot: string, pathname: string, platform: string): Response {
  const rel = decodeURIComponent(pathname.slice('/assets/'.length));
  const abs = path.resolve(projectRoot, rel);
  if (!abs.startsWith(projectRoot + path.sep)) return new Response('Forbidden', { status: 403 });
  const scale = Number(path.basename(abs).match(/@([\d.]+)x(\.[^.]+)?\.[^.]+$/)?.[1] ?? 1);
  try {
    const { scales, files } = getAssetRecord(abs, platform);
    const i = scales.findIndex((s) => s >= scale);
    return new Response(Bun.file(files[i === -1 ? files.length - 1 : i]));
  } catch {
    return new Response('Asset not found', { status: 404 });
  }
}

// ---------------------------------------------------------------- symbolication

function symbolicate(projectRoot: string, stack: any[], traceFor: (file: string) => any, originalPositionFor: any) {
  const mapped = stack.map((frame: any) => {
    if (!frame?.file || !/\.bundle(\?|$)/.test(frame.file) || frame.lineNumber == null) return frame;
    const trace = traceFor(frame.file);
    if (!trace) return frame;
    const pos = originalPositionFor(trace, { line: frame.lineNumber, column: Math.max(0, (frame.column ?? 1) - 1) });
    if (pos.source == null) return frame;
    return { ...frame, file: path.resolve(projectRoot, pos.source), lineNumber: pos.line, column: (pos.column ?? 0) + 1, methodName: pos.name ?? frame.methodName };
  });
  return { stack: mapped, codeFrame: null };
}
