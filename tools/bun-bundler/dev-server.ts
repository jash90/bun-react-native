// Development server for the Bun bundler (replaces the Metro dev server), built on Bun.serve.
//
// Speaks what the React Native runtime asks a packager for:
//   GET  /status                       -> "packager-status:running" (RCTBundleURLProvider)
//   GET  /<entry>.bundle?platform=..   -> dev bundle (built on demand, transform cache on disk)
//   GET  /<entry>.map?platform=..      -> its source map
//   GET  /assets/<dir>/<name>[@Nx].ext -> asset files (best scale fallback)
//   POST /symbolicate                  -> stack frames mapped through the source map (LogBox)
//   WS   /message                      -> packager messages; we broadcast {"method":"reload"} after edits
//   WS   /hot                          -> HMR client registration + device logs (printed here)
// Edits trigger a rebuild and a reload (live reload). Metro-style module hot replacement / Fast Refresh
// needs Metro's module format and is not implemented.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ServerWebSocket } from 'bun';

import { bundle } from './bundle';

export interface DevServerOptions {
  projectRoot: string;
  port: number;
  host?: string;
}

interface Built {
  code: string;
  map: string;
  builtAt: number;
  ms: number;
}

const IGNORED_DIRS = /(^|[\\/])(node_modules|\.git|ios|android|\.expo|dist|coverage)([\\/]|$)/;

export async function startDevServer(opts: DevServerOptions) {
  const { projectRoot, port } = opts;
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const entryFile = req.resolve(pkg.main ?? './index.js', { paths: [projectRoot] });
  const outDir = path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler', 'dev-out');
  fs.mkdirSync(outDir, { recursive: true });

  const builds = new Map<string, Promise<Built>>(); // per platform
  const messageSockets = new Set<ServerWebSocket<any>>();

  const build = (platform: 'ios' | 'android'): Promise<Built> => {
    let p = builds.get(platform);
    if (!p) {
      p = (async () => {
        const t0 = performance.now();
        const bundleOutput = path.join(outDir, `${platform}.bundle.js`);
        const sourcemapOutput = path.join(outDir, `${platform}.bundle.map`);
        await bundle({ projectRoot, entryFile, platform, dev: true, minify: false, bundleOutput, sourcemapOutput });
        const built = {
          code: fs.readFileSync(bundleOutput, 'utf8'),
          map: fs.readFileSync(sourcemapOutput, 'utf8'),
          builtAt: Date.now(),
          ms: Math.round(performance.now() - t0),
        };
        console.log(`${platform === 'ios' ? 'iOS' : 'Android'} Bundled ${built.ms}ms with Bun`);
        return built;
      })();
      builds.set(platform, p);
      p.catch((e) => {
        console.error(e?.message ?? e);
        builds.delete(platform);
      });
    }
    return p;
  };

  // ---- file watching -> rebuild -> reload
  let timer: ReturnType<typeof setTimeout> | null = null;
  // fs.watch also reports events for files whose content did not change (e.g. reads by other tools):
  // only react to a new mtime/size.
  const seen = new Map<string, string>();
  const changed = (rel: string) => {
    try {
      const st = fs.statSync(path.join(projectRoot, rel));
      const sig = `${st.mtimeMs}:${st.size}`;
      const prev = seen.get(rel);
      seen.set(rel, sig);
      return prev === undefined ? Date.now() - st.mtimeMs < 2000 : prev !== sig;
    } catch {
      return seen.delete(rel); // deleted
    }
  };
  fs.watch(projectRoot, { recursive: true }, (_event, filename) => {
    if (!filename || IGNORED_DIRS.test(String(filename))) return;
    if (!changed(String(filename))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const platforms = [...builds.keys()] as ('ios' | 'android')[];
      builds.clear();
      console.log(`Change in ${filename}, rebuilding ${platforms.join(', ') || '(no clients yet)'}`);
      try {
        await Promise.all(platforms.map(build));
        for (const ws of messageSockets) ws.send(JSON.stringify({ version: 2, method: 'reload' }));
      } catch {
        // error already printed; keep the previous app state
      }
    }, 60);
  });

  const server = Bun.serve({
    port,
    hostname: opts.host ?? '0.0.0.0',
    idleTimeout: 0,
    async fetch(request, srv) {
      const url = new URL(request.url);
      const { pathname, searchParams } = url;
      const platform = (searchParams.get('platform') ?? 'ios') as 'ios' | 'android';

      if (pathname === '/message' || pathname === '/hot') {
        if (srv.upgrade(request, { data: { kind: pathname.slice(1) } })) return undefined as any;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      if (pathname === '/status') return new Response('packager-status:running');
      if (pathname.endsWith('.bundle')) {
        try {
          const b = await build(platform);
          return new Response(b.code, { headers: { 'Content-Type': 'application/javascript; charset=UTF-8' } });
        } catch (e: any) {
          // RN shows this body in its red box
          return Response.json({ type: 'TransformError', message: String(e?.message ?? e) }, { status: 500 });
        }
      }
      if (pathname.endsWith('.map')) {
        const b = await build(platform);
        return new Response(b.map, { headers: { 'Content-Type': 'application/json' } });
      }
      if (pathname.startsWith('/assets/')) return serveAsset(projectRoot, pathname, platform);
      if (pathname === '/symbolicate' && request.method === 'POST') {
        const body = await request.json();
        const b = await build(platform);
        return Response.json(symbolicate(projectRoot, body.stack ?? [], b.map));
      }
      if (pathname === '/open-stack-frame' || pathname === '/open-url') return new Response('');
      if (pathname === '/json' || pathname === '/json/list') return Response.json([]);
      return new Response('Not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === 'message') messageSockets.add(ws);
      },
      close(ws) {
        messageSockets.delete(ws);
      },
      message(ws, raw) {
        if (ws.data.kind !== 'hot') return;
        let msg: any;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.type === 'register-entrypoints') ws.send(JSON.stringify({ type: 'bundle-registered' }));
        else if (msg.type === 'log') console.log(`[${msg.level ?? 'log'}]`, ...(msg.data ?? []));
      },
    },
  });

  console.log(`Bun dev server listening on http://localhost:${server.port}`);
  return server;
}

// ---------------------------------------------------------------- assets

function serveAsset(projectRoot: string, pathname: string, platform: string): Response {
  const rel = decodeURIComponent(pathname.slice('/assets/'.length));
  const abs = path.join(projectRoot, rel);
  if (!abs.startsWith(projectRoot + path.sep)) return new Response('Forbidden', { status: 403 });
  const { dir, name, ext } = path.parse(abs);
  const base = name.replace(/@\d+(\.\d+)?x$/, '');
  const candidates = [abs, path.join(dir, `${base}.${platform}${ext}`), path.join(dir, `${base}${ext}`)];
  for (const c of candidates) {
    if (fs.existsSync(c)) return new Response(Bun.file(c));
  }
  // closest available scale
  const scales = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(base) && f.endsWith(ext)).sort() : [];
  if (scales.length) return new Response(Bun.file(path.join(dir, scales[scales.length - 1])));
  return new Response('Asset not found', { status: 404 });
}

// ---------------------------------------------------------------- symbolication

let traceMapCache: { raw: string; tm: any } | null = null;

function symbolicate(projectRoot: string, stack: any[], rawMap: string) {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const { TraceMap, originalPositionFor } = req('@jridgewell/trace-mapping');
  if (!traceMapCache || traceMapCache.raw !== rawMap) traceMapCache = { raw: rawMap, tm: new TraceMap(rawMap) };
  const tm = traceMapCache.tm;
  const mapped = stack.map((frame: any) => {
    if (!frame?.file || !/\.bundle(\?|$)/.test(frame.file) || frame.lineNumber == null) return frame;
    const pos = originalPositionFor(tm, { line: frame.lineNumber, column: Math.max(0, (frame.column ?? 1) - 1) });
    if (pos.source == null) return frame;
    return {
      ...frame,
      file: path.resolve(projectRoot, pos.source),
      lineNumber: pos.line,
      column: (pos.column ?? 0) + 1,
      methodName: pos.name ?? frame.methodName,
    };
  });
  return { stack: mapped, codeFrame: null };
}
