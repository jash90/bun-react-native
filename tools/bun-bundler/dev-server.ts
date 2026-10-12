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
import { createWebDevHandler } from './web-dev';

export interface DevServerOptions {
  projectRoot: string;
  port: number;
  host?: string;
}

type Platform = 'ios' | 'android' | 'web';

const PLATFORM_LABEL: Record<Platform, string> = { ios: 'iOS', android: 'Android', web: 'Web' };
const platformOf = (url: string): Platform =>
  /[?&]platform=android/.test(url) ? 'android' : /[?&]platform=web/.test(url) ? 'web' : 'ios';
type WsData = { kind: 'hot' | 'message' | 'inspector'; platform?: Platform; [k: string]: any };

const IGNORED_DIRS = /(^|[\\/])(node_modules|\.git|ios|android|\.expo|dist|coverage)([\\/]|$)/;

export async function startDevServer(opts: DevServerOptions) {
  const { projectRoot, port } = opts;
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const { TraceMap, FlattenMap, originalPositionFor, encodedMap } = req('@jridgewell/trace-mapping');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const entryFile = path.relative(projectRoot, req.resolve(pkg.main ?? './index.js', { paths: [projectRoot] }));

  const graphs = new Map<Platform, DevGraph>();
  const lastBundleUrl = new Map<Platform, string>();
  const hotClients = new Set<ServerWebSocket<WsData>>();
  const messageClients = new Set<ServerWebSocket<WsData>>();
  const mapCache = new Map<Platform, { raw: any; flat: any; trace: any }>();
  let revision = 0;

  const graph = (platform: Platform) => {
    let g = graphs.get(platform);
    if (!g) {
      g = new DevGraph({ projectRoot, platform, entryFile });
      graphs.set(platform, g);
    }
    return g;
  };

  // one serialization per platform at a time (bundle + parallel source map requests share it)
  const inflight = new Map<Platform, Promise<string>>();
  function serialize(platform: Platform, url: URL): Promise<string> {
    let p = inflight.get(platform);
    if (!p) {
      p = serializeNow(platform, url).finally(() => inflight.delete(platform));
      inflight.set(platform, p);
    }
    return p;
  }

  async function serializeNow(platform: Platform, url: URL) {
    const g = graph(platform);
    const t0 = performance.now();
    const fresh = !g.has(path.resolve(projectRoot, entryFile));
    const mapUrl = new URL(url);
    mapUrl.pathname = url.pathname.replace(/\.bundle$/, '.map');
    const result = await g.serialize(url.toString(), mapUrl.toString());
    mapCache.delete(platform);
    mapCache.set(platform, { raw: result.map, flat: null, trace: null });
    lastBundleUrl.set(platform, url.toString());
    const { cacheHits, transformed } = g.project.stats;
    console.log(
      `${PLATFORM_LABEL[platform]} Bundled ${Math.round(performance.now() - t0)}ms with Bun` +
        (fresh ? ` (${transformed} transformed, ${cacheHits} from cache)` : '')
    );
    return result.code;
  }

  function flatMap(platform: Platform) {
    const entry = mapCache.get(platform);
    if (!entry) return null;
    if (!entry.trace) {
      entry.trace = new FlattenMap(entry.raw);
      entry.flat = encodedMap(entry.trace);
    }
    return entry;
  }

  // ---- HMR
  function sendHot(platform: Platform, msg: object) {
    const data = JSON.stringify(msg);
    let sent = 0;
    for (const ws of hotClients) {
      if (ws.data.platform === platform) {
        ws.send(data);
        sent++;
      }
    }
    return sent;
  }

  const web = createWebDevHandler({ projectRoot, port });

  async function onFilesChanged(files: string[]) {
    web.invalidate(files);
    for (const [platform, g] of graphs) {
      const base = lastBundleUrl.get(platform);
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
        sendHot(platform, { type: 'error', body: { type: 'TransformError', message, errors: [{ description: message }] } });
        continue;
      }
      if (!update) continue;
      mapCache.delete(platform); // positions of modified modules changed; rebuilt on next bundle/map request
      const names = [...update.modified, ...update.added].map((m) => g.nameOf(m.module[0]));
      const sent = sendHot(platform, { type: 'update-start', body: { isInitialUpdate: false } });
      if (sent) {
        sendHot(platform, { type: 'update', body: { ...update, revisionId: String(++revision), isInitialUpdate: false } });
        sendHot(platform, { type: 'update-done' });
        console.log(`[HMR ${platform}] ${names.join(', ')}`);
      } else {
        // no Fast Refresh client: reload the app instead
        for (const ws of messageClients) ws.send(JSON.stringify({ version: 2, method: 'reload' }));
        console.log(`[reload ${platform}] ${names.join(', ')}`);
      }
    }
  }

  // ---- file watching (fs.watch also reports reads/no-op events: react to new mtime/size only)
  const seen = new Map<string, string>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const changed = (rel: string) => {
    try {
      const st = fs.statSync(path.join(projectRoot, rel));
      const sig = `${st.mtimeMs}:${st.size}`;
      const prev = seen.get(rel);
      seen.set(rel, sig);
      return prev === undefined ? Date.now() - st.mtimeMs < 2000 : prev !== sig;
    } catch {
      return seen.delete(rel) || true; // deleted
    }
  };
  fs.watch(projectRoot, { recursive: true }, (_event, filename) => {
    if (!filename || IGNORED_DIRS.test(String(filename))) return;
    if (!changed(String(filename))) return;
    pending.add(path.join(projectRoot, String(filename)));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...pending];
      pending.clear();
      onFilesChanged(files).catch((e) => console.error(e));
    }, 30);
  });

  const { inspector } = await import('./inspector').then((m) => ({ inspector: m.createInspectorProxy({ projectRoot, port }) }));

  const server: Server<WsData> = Bun.serve<WsData, any>({
    port,
    hostname: opts.host ?? '0.0.0.0',
    idleTimeout: 0,
    async fetch(request, srv) {
      const url = new URL(request.url);
      const { pathname, searchParams } = url;
      const platform = (searchParams.get('platform') ?? 'ios') as Platform;

      if (pathname === '/hot' || pathname === '/message') {
        if (srv.upgrade(request, { data: { kind: pathname.slice(1) as 'hot' | 'message' } })) return undefined as any;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      const inspectorResponse = await inspector.fetch(request, srv);
      if (inspectorResponse !== null) return inspectorResponse;

      if (pathname === '/status') return new Response('packager-status:running');
      if (pathname.endsWith('.bundle')) {
        try {
          const code = await serialize(platform, url);
          return new Response(code, { headers: { 'Content-Type': 'application/javascript; charset=UTF-8' } });
        } catch (e: any) {
          const message = String(e?.message ?? e);
          console.error(message);
          return Response.json({ type: 'TransformError', message, errors: [{ description: message }] }, { status: 500 });
        }
      }
      if (pathname.endsWith('.map')) {
        if (!mapCache.has(platform)) await serialize(platform, new URL(url.toString().replace(/\.map(\?|$)/, '.bundle$1')));
        return Response.json(flatMap(platform)!.flat);
      }
      if (pathname.startsWith('/assets/')) return serveAsset(projectRoot, pathname, searchParams.get('platform') ?? 'web');
      if (pathname === '/symbolicate' && request.method === 'POST') {
        const body = await request.json();
        const bundleFrame = (body.stack ?? []).map((f: any) => f?.file).find((f: string) => /\.bundle(\?|$)/.test(f ?? ''));
        const p = bundleFrame ? platformOf(bundleFrame) : platform;
        if (!mapCache.has(p)) return Response.json({ stack: body.stack ?? [], codeFrame: null });
        return Response.json(symbolicate(projectRoot, body.stack ?? [], flatMap(p)!.trace, originalPositionFor));
      }
      if (pathname === '/open-stack-frame' || pathname === '/open-url') return new Response('');
      const webResponse = await web.fetch(request);
      if (webResponse) return webResponse;
      return new Response('Not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === 'message') messageClients.add(ws);
        else if (ws.data.kind === 'inspector') inspector.websocket.open(ws);
      },
      close(ws) {
        hotClients.delete(ws);
        messageClients.delete(ws);
        if (ws.data.kind === 'inspector') inspector.websocket.close(ws);
      },
      message(ws, raw) {
        if (ws.data.kind === 'inspector') return inspector.websocket.message(ws, raw);
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
          hotClients.add(ws);
          ws.send(JSON.stringify({ type: 'bundle-registered' }));
        } else if (msg.type === 'log') {
          console.log(`[${ws.data.platform ?? 'app'} ${msg.level ?? 'log'}]`, ...(msg.data ?? []));
        }
      },
    },
  });

  console.log(`Bun dev server listening on http://localhost:${server.port}`);
  return server;
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

function symbolicate(projectRoot: string, stack: any[], trace: any, originalPositionFor: any) {
  const mapped = stack.map((frame: any) => {
    if (!frame?.file || !/\.bundle(\?|$)/.test(frame.file) || frame.lineNumber == null) return frame;
    const pos = originalPositionFor(trace, { line: frame.lineNumber, column: Math.max(0, (frame.column ?? 1) - 1) });
    if (pos.source == null) return frame;
    return { ...frame, file: path.resolve(projectRoot, pos.source), lineNumber: pos.line, column: (pos.column ?? 0) + 1, methodName: pos.name ?? frame.methodName };
  });
  return { stack: mapped, codeFrame: null };
}
