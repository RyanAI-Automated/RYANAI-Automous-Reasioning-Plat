import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';
import { WebSocket, WebSocketServer } from 'ws';

const required = ['REDIS_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`Missing required connectivity bridge setting: ${key}`);
}
const port = Number(process.env.BRIDGE_PORT || 8787);
const ticketTtl = 30;
const maxPayload = 64 * 1024;
const streamMaxLength = Number(process.env.BRIDGE_STREAM_MAX_LENGTH || 10000);
const origins = new Set((process.env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean));
if (process.env.NODE_ENV !== 'production') {
  for (const origin of ['http://localhost:1420', 'http://127.0.0.1:1420', 'http://localhost:9090', 'http://127.0.0.1:9090']) origins.add(origin);
}

const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (error) => console.error('[connectivity-bridge] Redis error', error.message));
await redis.connect();

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname === '/livez' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'alive', service: 'ryanai-connectivity-bridge' }));
    return;
  }
  if (url.pathname === '/readyz' && request.method === 'GET') {
    try {
      await redis.ping();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ready', redis: 'connected' }));
    } catch {
      response.writeHead(503);
      response.end();
    }
    return;
  }
  if (url.pathname !== '/v1/ticket' || request.method !== 'POST') {
    response.writeHead(404);
    response.end();
    return;
  }
  const origin = request.headers.origin;
  if (origin && !origins.has(origin)) {
    response.writeHead(403);
    response.end(JSON.stringify({ error: 'Origin is not allowed.' }));
    return;
  }
  const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization || '')?.[1];
  if (!bearer || bearer.length > 8192) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: 'A verified sign-in is required.' }));
    return;
  }
  try {
    const authResponse = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!authResponse.ok) {
      response.writeHead(authResponse.status >= 500 ? 503 : 401);
      response.end(JSON.stringify({ error: authResponse.status >= 500 ? 'Authentication is temporarily unavailable.' : 'The session is invalid or expired.' }));
      return;
    }
    const user = await authResponse.json();
    if (!user?.id || user.is_anonymous) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: 'A non-anonymous signed-in user is required.' }));
      return;
    }
    const ticket = randomBytes(32).toString('base64url');
    const stored = await redis.set(`ryanai:connectivity:ticket:${ticket}`, JSON.stringify({ userId: user.id }), { EX: ticketTtl, NX: true });
    if (stored !== 'OK') throw new Error('Could not reserve a one-time connection ticket');
    response.writeHead(201, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ ticket, expiresIn: ticketTtl }));
  } catch (error) {
    console.error('[connectivity-bridge] Ticket issuance failed', error.message);
    if (!response.headersSent) {
      response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'Could not issue a connection ticket. Retry shortly.' }));
    }
  }
});

const sockets = new WebSocketServer({ noServer: true, maxPayload });
server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const origin = request.headers.origin;
  if (origin && !origins.has(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const ticket = url.searchParams.get('ticket');
  if (url.pathname !== '/v1/socket' || !ticket || ticket.length > 128) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  try {
    const serialized = await redis.getDel(`ryanai:connectivity:ticket:${ticket}`);
    if (!serialized) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const identity = JSON.parse(serialized);
    if (!identity.userId) throw new Error('Invalid ticket identity');
    sockets.handleUpgrade(request, socket, head, (ws) => {
      ws.userId = identity.userId;
      sockets.emit('connection', ws, request);
    });
  } catch {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
  }
});

sockets.on('connection', (ws) => {
  let cursor = '0-0';
  let closed = false;
  let reading = false;
  let requestedCursor = false;
  const stream = `ryanai:connectivity:events:${ws.userId}`;
  const cursorKey = `ryanai:connectivity:cursor:${ws.userId}`;
  const send = (value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };

  ws.on('message', async (raw) => {
    if (raw.length > maxPayload) return ws.close(1009, 'Message too large');
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return send({ type: 'error', error: 'Invalid JSON' }); }
    if (message?.type === 'resume' && !requestedCursor) {
      requestedCursor = true;
      const saved = await redis.get(cursorKey);
      cursor = typeof message.cursor === 'string' && /^\d+-\d+$/.test(message.cursor) ? message.cursor : saved || '0-0';
      send({ type: 'resumed', cursor });
      pump();
      return;
    }
    if (message?.type === 'ack' && typeof message.id === 'string' && /^\d+-\d+$/.test(message.id)) {
      const acknowledged = message.id;
      if (acknowledged > cursor) {
        cursor = acknowledged;
        await redis.set(cursorKey, cursor, { EX: 60 * 60 * 24 * 30 });
        send({ type: 'acknowledged', id: cursor });
      }
      return;
    }
    send({ type: 'error', error: 'Unsupported bridge message. This socket is a delivery channel, not a command executor.' });
  });

  async function pump() {
    if (reading || closed || ws.readyState !== WebSocket.OPEN) return;
    reading = true;
    try {
      while (!closed && ws.readyState === WebSocket.OPEN) {
        const rows = await redis.xRead([{ key: stream, id: cursor }], { BLOCK: 5000, COUNT: 50 });
        if (!rows) continue;
        for (const row of rows) {
          for (const entry of row.messages) {
            cursor = entry.id;
            let payload;
            try { payload = JSON.parse(entry.message.payload); } catch { payload = { type: 'bridge.event.invalid_payload' }; }
            send({ type: 'event', id: entry.id, data: payload });
          }
        }
      }
    } catch (error) {
      if (!closed) {
        console.error('[connectivity-bridge] Stream reader degraded', error.message);
        send({ type: 'degraded', retryable: true });
        setTimeout(() => { reading = false; pump(); }, 1500);
        return;
      }
    } finally {
      reading = false;
    }
  }

  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 25000);
  ws.on('close', () => { closed = true; clearInterval(heartbeat); });
  ws.on('error', () => { closed = true; clearInterval(heartbeat); });
});

server.listen(port, '0.0.0.0', () => console.log(`[connectivity-bridge] listening on ${port}`));
async function shutdown() {
  server.close();
  for (const ws of sockets.clients) ws.close(1001, 'Bridge restarting');
  await redis.quit();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
