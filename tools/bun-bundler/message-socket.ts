// `/message` websocket in the protocol of Expo's dev server (@expo/cli start/server/metro/dev-server/
// createMessageSocket): version-2 JSON messages; the server broadcasts commands (`reload`, `devMenu`,
// `sendDevCommand`); trusted clients (loopback socket, same origin) may broadcast `reload` / `devMenu`; requests
// with a `target` go to the server (`getid`, `getpeers`) or to another client, responses are routed back.
import type { ServerWebSocket } from 'bun';

const PROTOCOL_VERSION = 2;
const CLIENT_BROADCAST_ALLOWED_METHODS = new Set(['reload', 'devMenu']);

export interface MessageSocketData {
  /** loopback socket and no foreign `Origin` (Expo isLocalSocket + isMatchingOrigin) */
  trusted: boolean;
  /** upgrade query string (`getpeers` result) */
  query: Record<string, string>;
  clientId?: string;
}

/** Upgrade data for a `/message` connection. */
export function messageSocketData(request: Request, remoteAddress: string | undefined, serverBaseUrl: string): MessageSocketData {
  const ip = (remoteAddress ?? '').replace(/^::ffff:/, '');
  const local = ip === '::1' || ip.startsWith('127.');
  const origin = request.headers.get('origin');
  let sameOrigin = true;
  if (origin) {
    try {
      sameOrigin = new URL(origin).host === new URL(serverBaseUrl).host;
    } catch {
      sameOrigin = false;
    }
  }
  return { trusted: local && sameOrigin, query: Object.fromEntries(new URL(request.url).searchParams) };
}

export function createMessageSocket<T extends { message?: MessageSocketData }>(log: (msg: string) => void = console.warn) {
  const clients = new Map<string, ServerWebSocket<T>>();
  let nextId = 0;
  const serialize = (message: object) => JSON.stringify({ ...message, version: PROTOCOL_VERSION });
  const sendAll = (data: string, except?: ServerWebSocket<T>) => {
    for (const ws of clients.values()) if (ws !== except) ws.send(data);
  };

  return {
    get size() {
      return clients.size;
    },
    open(ws: ServerWebSocket<T>) {
      const id = `client#${nextId++}`;
      ws.data.message!.clientId = id;
      clients.set(id, ws);
    },
    close(ws: ServerWebSocket<T>) {
      if (ws.data.message?.clientId) clients.delete(ws.data.message.clientId);
    },
    /** Expo's broadcastMessage */
    broadcast(method: string, params?: object) {
      if (!clients.size) return log(`No apps connected. Sending "${method}" to all React Native apps failed. Make sure your app is running in the simulator or on a phone connected via USB.`);
      sendAll(serialize({ method, params }));
    },
    message(ws: ServerWebSocket<T>, raw: string | Buffer): void {
      if (typeof raw !== 'string' && !(raw instanceof Buffer)) return;
      let message: any;
      try {
        const { version, ...rest } = JSON.parse(String(raw)) ?? {};
        if (version !== PROTOCOL_VERSION) return;
        message = rest;
      } catch {
        return;
      }
      const meta = ws.data.message!;
      const isBroadcast = typeof message.method === 'string' && message.id === undefined && message.target === undefined;
      if (isBroadcast) {
        if (meta.trusted && CLIENT_BROADCAST_ALLOWED_METHODS.has(message.method)) sendAll(String(raw));
        return;
      }
      if (typeof message.method === 'string' && typeof message.target === 'string') {
        if (message.target === 'server') {
          if (!message.id) return;
          if (message.method === 'getid') {
            ws.send(serialize({ id: message.id, result: meta.clientId }));
            return;
          }
          if (message.method === 'getpeers') {
            const peers: Record<string, object> = {};
            for (const [id, peer] of clients) if (id !== meta.clientId) peers[id] = peer.data.message?.query ?? {};
            ws.send(serialize({ id: message.id, result: peers }));
          }
          return;
        }
        clients.get(message.target)?.send(serialize({ method: message.method, params: message.params, id: message.id ? { requestId: message.id, clientId: meta.clientId } : undefined }));
        return;
      }
      if (message.id && typeof message.id === 'object' && typeof message.id.clientId === 'string' && (message.result || message.error)) {
        clients.get(message.id.clientId)?.send(serialize({ id: message.id.requestId, result: message.result, error: message.error }));
      }
    },
  };
}
