// bun test - `/message` websocket protocol of Expo's dev server (createMessageSocket).
import { expect, test } from 'bun:test';

import { createMessageSocket, messageSocketData } from './message-socket';

const client = (trusted: boolean, query: Record<string, string> = {}) => {
  const sent: any[] = [];
  return { data: { message: { trusted, query } }, send: (d: string) => sent.push(JSON.parse(d)), sent } as any;
};

test('server broadcast, trusted client broadcasts, getid/getpeers, request/response routing', () => {
  const warnings: string[] = [];
  const socket = createMessageSocket<any>((m) => warnings.push(m));
  socket.broadcast('reload');
  expect(warnings[0]).toContain('No apps connected');

  const app = client(false, { device: 'phone' });
  const cli = client(true);
  socket.open(app);
  socket.open(cli);
  socket.broadcast('devMenu');
  expect(app.sent.pop()).toEqual({ method: 'devMenu', version: 2 });

  // untrusted clients cannot broadcast; trusted ones only reload/devMenu
  socket.message(app, JSON.stringify({ version: 2, method: 'reload' }));
  expect(cli.sent).toEqual([{ method: 'devMenu', version: 2 }]);
  socket.message(cli, JSON.stringify({ version: 2, method: 'sendDevCommand' }));
  expect(app.sent).toEqual([]);
  socket.message(cli, JSON.stringify({ version: 2, method: 'reload' }));
  expect(app.sent.pop()).toEqual({ version: 2, method: 'reload' });

  socket.message(cli, JSON.stringify({ version: 2, id: 1, method: 'getid', target: 'server' }));
  expect(cli.sent.pop()).toEqual({ id: 1, result: cli.data.message.clientId, version: 2 });
  socket.message(cli, JSON.stringify({ version: 2, id: 2, method: 'getpeers', target: 'server' }));
  expect(cli.sent.pop()).toEqual({ id: 2, result: { [app.data.message.clientId]: { device: 'phone' } }, version: 2 });

  socket.message(cli, JSON.stringify({ version: 2, id: 3, method: 'ping', target: app.data.message.clientId }));
  const request = app.sent.pop();
  expect(request).toEqual({ method: 'ping', id: { requestId: 3, clientId: cli.data.message.clientId }, version: 2 });
  socket.message(app, JSON.stringify({ version: 2, id: request.id, result: 'pong' }));
  expect(cli.sent.pop()).toEqual({ id: 3, result: 'pong', version: 2 });

  // other protocol versions are ignored
  socket.message(cli, JSON.stringify({ version: 1, method: 'reload' }));
  expect(app.sent).toEqual([]);
});

test('trust: loopback socket without a foreign Origin', () => {
  const req = (origin?: string) => new Request('http://localhost:8081/message?x=1', { headers: origin ? { origin } : {} });
  expect(messageSocketData(req(), '127.0.0.1', 'http://localhost:8081')).toEqual({ trusted: true, query: { x: '1' } });
  expect(messageSocketData(req(), '::ffff:127.0.0.1', 'http://localhost:8081').trusted).toBe(true);
  expect(messageSocketData(req(), '192.168.1.20', 'http://localhost:8081').trusted).toBe(false);
  expect(messageSocketData(req('https://evil.example'), '127.0.0.1', 'http://localhost:8081').trusted).toBe(false);
  expect(messageSocketData(req('http://localhost:8081'), '::1', 'http://localhost:8081').trusted).toBe(true);
});
