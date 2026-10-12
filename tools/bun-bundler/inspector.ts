// Inspector proxy of the Bun dev server (replaces @react-native/dev-middleware's InspectorProxy).
// Same protocol as React Native's runtime and debuggers expect:
//
//   device   WS /inspector/device?device=&name=&app=   <- {event:'getPages'} every second
//                                                      -> {event:'getPages', payload:[{id,title,app,vm,capabilities}]}
//                                                      <- {event:'connect'|'disconnect', payload:{pageId, sessionId}}
//                                                      <-> {event:'wrappedEvent', payload:{pageId, wrappedEvent, sessionId}}
//   debugger WS /inspector/debug?device=&page=        <-> raw CDP JSON (relayed as wrappedEvent)
//   HTTP     /json, /json/list, /json/version         page list for debuggers (React Native DevTools, Chrome, tools)
//   HTTP     /open-debugger?device=&target=            opens React Native DevTools (served from /debugger-frontend/)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Server, ServerWebSocket } from 'bun';

interface Page {
  id: string;
  title: string;
  app?: string;
  vm?: string;
  description?: string;
  capabilities?: Record<string, boolean>;
}

interface Device {
  id: string;
  name: string;
  app: string;
  socket: ServerWebSocket<any>;
  pages: Page[];
  sessions: Map<string, ServerWebSocket<any>>; // sessionId -> debugger socket
  timer: ReturnType<typeof setInterval>;
}

export function createInspectorProxy(opts: { projectRoot: string; port: number }) {
  const devices = new Map<string, Device>();
  const req = createRequire(path.join(opts.projectRoot, 'package.json'));
  let frontendRoot: string | null = null;
  try {
    frontendRoot = path.join(path.dirname(req.resolve('@react-native/debugger-frontend/package.json')), 'dist', 'third-party', 'front_end');
  } catch {
    frontendRoot = null;
  }

  const pageList = (host: string) => {
    const out: any[] = [];
    for (const device of devices.values()) {
      for (const page of device.pages) {
        const ws = `${host}/inspector/debug?device=${encodeURIComponent(device.id)}&page=${encodeURIComponent(page.id)}`;
        const frontend = `/debugger-frontend/rn_fusebox.html?${new URLSearchParams([
          ['ws', `/inspector/debug?device=${device.id}&page=${page.id}`],
          ['sources.hide_add_folder', 'true'],
        ])}`;
        out.push({
          id: `${device.id}-${page.id}`,
          title: page.title,
          description: page.description ?? page.app ?? device.app,
          appId: page.app ?? device.app,
          type: 'node',
          devtoolsFrontendUrl: frontend,
          webSocketDebuggerUrl: `ws://${ws}`,
          ...(page.vm != null ? { vm: page.vm } : {}),
          deviceName: device.name,
          reactNative: { logicalDeviceId: device.id, capabilities: page.capabilities ?? {} },
        });
      }
    }
    return out;
  };

  const sendToDevice = (device: Device, message: object) => {
    try {
      device.socket.send(JSON.stringify(message));
    } catch {}
  };

  return {
    /** HTTP + upgrade handling; returns null when the request is not for the inspector. */
    async fetch(request: Request, srv: Server<any>): Promise<Response | null | undefined> {
      const url = new URL(request.url);
      const { pathname, searchParams } = url;
      if (pathname === '/inspector/device') {
        const data = {
          kind: 'inspector',
          role: 'device',
          deviceId: searchParams.get('device') ?? crypto.randomUUID(),
          name: searchParams.get('name') ?? 'Unknown device',
          app: searchParams.get('app') ?? 'Unknown app',
        };
        return srv.upgrade(request, { data } as any) ? undefined : new Response('Upgrade failed', { status: 400 });
      }
      if (pathname === '/inspector/debug') {
        const deviceId = searchParams.get('device');
        const pageId = searchParams.get('page');
        if (!deviceId || !pageId || !devices.has(deviceId)) return new Response('Unknown device or page', { status: 404 });
        const data = { kind: 'inspector', role: 'debugger', deviceId, pageId, sessionId: crypto.randomUUID() };
        return srv.upgrade(request, { data } as any) ? undefined : new Response('Upgrade failed', { status: 400 });
      }
      if (pathname === '/json' || pathname === '/json/list') return Response.json(pageList(url.host));
      if (pathname === '/json/version') return Response.json({ Browser: 'Mobile JavaScript', 'Protocol-Version': '1.1' });
      if (pathname === '/open-debugger') {
        const target = searchParams.get('target');
        const deviceParam = searchParams.get('device');
        const pages = pageList(url.host).filter(
          (p) => (!target || p.id === target) && (!deviceParam || p.reactNative.logicalDeviceId === deviceParam)
        );
        const page = pages[pages.length - 1];
        if (!page) return new Response('No debuggable target', { status: 404 });
        const frontendUrl = `${url.origin}${page.devtoolsFrontendUrl}`;
        Bun.spawn(process.platform === 'darwin' ? ['open', frontendUrl] : ['xdg-open', frontendUrl], { stdio: ['ignore', 'ignore', 'ignore'] });
        return new Response(frontendUrl);
      }
      if (pathname.startsWith('/debugger-frontend/')) {
        if (!frontendRoot) return new Response('@react-native/debugger-frontend not installed', { status: 404 });
        const rel = decodeURIComponent(pathname.slice('/debugger-frontend/'.length)) || 'rn_fusebox.html';
        const file = path.join(frontendRoot, rel);
        if (!file.startsWith(frontendRoot) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
        return new Response(Bun.file(file));
      }
      return null;
    },

    websocket: {
      open(ws: ServerWebSocket<any>) {
        const d = ws.data;
        if (d.role === 'device') {
          const previous = devices.get(d.deviceId);
          if (previous) {
            clearInterval(previous.timer);
            for (const s of previous.sessions.values()) s.close(1011, 'Device reconnected');
          }
          const device: Device = {
            id: d.deviceId,
            name: d.name,
            app: d.app,
            socket: ws,
            pages: [],
            sessions: new Map(),
            timer: setInterval(() => sendToDevice(device, { event: 'getPages' }), 1000),
          };
          devices.set(d.deviceId, device);
          sendToDevice(device, { event: 'getPages' });
        } else if (d.role === 'debugger') {
          const device = devices.get(d.deviceId);
          if (!device) return ws.close(1011, 'Unknown device');
          device.sessions.set(d.sessionId, ws);
          sendToDevice(device, { event: 'connect', payload: { pageId: d.pageId, sessionId: d.sessionId } });
        }
      },
      message(ws: ServerWebSocket<any>, raw: string | Buffer) {
        const d = ws.data;
        if (d.role === 'debugger') {
          const device = devices.get(d.deviceId);
          if (device) sendToDevice(device, { event: 'wrappedEvent', payload: { pageId: d.pageId, wrappedEvent: String(raw), sessionId: d.sessionId } });
          return;
        }
        const device = devices.get(d.deviceId);
        if (!device) return;
        let msg: any;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.event === 'getPages') {
          device.pages = msg.payload ?? [];
        } else if (msg.event === 'wrappedEvent') {
          const { sessionId, wrappedEvent } = msg.payload ?? {};
          const target = sessionId != null ? device.sessions.get(sessionId) : device.sessions.values().next().value;
          target?.send(wrappedEvent);
        } else if (msg.event === 'disconnect') {
          const { sessionId } = msg.payload ?? {};
          const target = sessionId != null ? device.sessions.get(sessionId) : null;
          if (target) {
            target.close(1000, 'Page disconnected');
            device.sessions.delete(sessionId);
          }
        }
      },
      close(ws: ServerWebSocket<any>) {
        const d = ws.data;
        if (d.role === 'device') {
          const device = devices.get(d.deviceId);
          if (device?.socket === ws) {
            clearInterval(device.timer);
            for (const s of device.sessions.values()) s.close(1011, 'Device disconnected');
            devices.delete(d.deviceId);
          }
        } else if (d.role === 'debugger') {
          const device = devices.get(d.deviceId);
          if (device?.sessions.get(d.sessionId) === ws) {
            device.sessions.delete(d.sessionId);
            sendToDevice(device, { event: 'disconnect', payload: { pageId: d.pageId, sessionId: d.sessionId } });
          }
        }
      },
    },
  };
}
