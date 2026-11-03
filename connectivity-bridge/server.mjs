import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from 'redis';
import { WebSocket, WebSocketServer } from 'ws';
import { canAcknowledgeNext, compareStreamIds, publishUserEvent, userCursorKey, userStreamKey } from './stream-store.mjs';

const required = ['REDIS_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error('Missing required connectivity bridge setting: ' + key);
}
const port = Number(process.env.BRIDGE_PORT || 8787);
const ticketTtl = Number(process.env.BRIDGE_TICKET_TTL_SECONDS || 30);
const streamMaxLength = Number(process.env.BRIDGE_STREAM_MAX_LENGTH || 10000);
const maxPayload = 256 * 1024;
const adapterToken = process.env.BRIDGE_ADAPTER_TOKEN || '';
const origins = new Set((process.env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BRIDGE_PORT must be a valid TCP port.');
if (!Number.isInteger(ticketTtl) || ticketTtl < 5 || ticketTtl > 120) throw new Error('BRIDGE_TICKET_TTL_SECONDS must be between 5 and 120.');
if (!Number.isInteger(streamMaxLength) || streamMaxLength < 100) throw new Error('BRIDGE_STREAM_MAX_LENGTH must be at least 100.');
if (adapterToken && adapterToken.length < 32) throw new Error('BRIDGE_ADAPTER_TOKEN must contain at least 32 characters.');

const redis = createClient({
  url: process.env.REDIS_URL,
  socket: { reconnectStrategy: (retries) => Math.min(250 * 2 ** Math.min(retries, 6), 10000) },
});
redis.on('error', (error) => console.error('[connectivity-bridge] Redis connection degraded:', error.message));
await redis.connect();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeEqual = (actual, expected) => {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
const getBearer = (request) => /^Bearer ([^\s]+)$/i.exec(request.headers.authorization || '')?.[1] || '';
const sendJson = (response, status, body) => {
  const serialized = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(serialized) });
  response.end(serialized);
};
async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxPayload) throw new Error('BODY_TOO_LARGE');
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw new Error('INVALID_JSON'); }
}
async function adapterStatuses() {
  const statuses = { bridge: 'ready', redis: 'ready', api: 'unavailable', mcp: 'unavailable' };
  for (const name of ['api', 'mcp']) {
    const value = await redis.get('ryanai:connectivity:adapter:' + name);
    if (value) {
      try {
        const parsed = JSON.parse(value);
        if (Date.now() - parsed.checkedAt < 45000) statuses[name] = 'ready';
      } catch { /* malformed heartbeat remains unavailable */ }
    }
  }
  return statuses;
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin) {
    if (!origins.has(origin)) return sendJson(response, 403, { error: 'Origin is not allowed.' });
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
    response.setHeader('access-control-max-age', '600');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'cache-control': 'no-store' });
    response.end();
    return;
  }
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname === '/livez' && request.method === 'GET') {
    return sendJson(response, 200, { status: 'alive', service: 'ryanai-connectivity-bridge' });
  }
  if (url.pathname === '/readyz' && request.method === 'GET') {
    try {
      await redis.ping();
      return sendJson(response, 200, { status: 'ready', dependencies: await adapterStatuses() });
    } catch {
      return sendJson(response, 503, { status: 'degraded', dependencies: { redis: 'unavailable' } });
    }
  }
  if (url.pathname === '/v1/ticket' && request.method === 'POST') {
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) return sendJson(response, 403, { error: 'Origin is not allowed.' });
    const bearer = getBearer(request);
    if (!bearer || bearer.length > 8192) return sendJson(response, 401, { error: 'A verified sign-in is required.' });
    try {
      const authResponse = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
        headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, authorization: 'Bearer ' + bearer },
        signal: AbortSignal.timeout(5000),
      });
      if (!authResponse.ok) return sendJson(response, authResponse.status >= 500 ? 503 : 401, { error: authResponse.status >= 500 ? 'Authentication is temporarily unavailable.' : 'The session is invalid or expired.' });
      const user = await authResponse.json();
      if (!user?.id || user.is_anonymous) return sendJson(response, 401, { error: 'A non-anonymous signed-in user is required.' });
      const rateKey = 'ryanai:connectivity:ticket-rate:' + user.id;
      const attempts = await redis.incr(rateKey);
      if (attempts === 1) await redis.expire(rateKey, 60);
      if (attempts > 20) return sendJson(response, 429, { error: 'Too many ticket requests. Retry shortly.' });
      const ticket = randomBytes(32).toString('base64url');
      const stored = await redis.set('ryanai:connectivity:ticket:' + ticket, JSON.stringify({ userId: user.id }), { EX: ticketTtl, NX: true });
      if (stored !== 'OK') throw new Error('Could not reserve a single-use ticket.');
      return sendJson(response, 201, { ticket, expiresIn: ticketTtl });
    } catch (error) {
      console.error('[connectivity-bridge] Ticket issuance failed:', error.message);
      return sendJson(response, 503, { error: 'Could not issue a connection ticket. Retry shortly.' });
    }
  }
  if (url.pathname.startsWith('/internal/') && !adapterToken) return sendJson(response, 503, { error: 'Bridge adapter authentication is not configured.' });
  if (url.pathname.startsWith('/internal/') && !safeEqual(getBearer(request), adapterToken)) return sendJson(response, 401, { error: 'Unauthorized.' });
  if (url.pathname === '/internal/events' && request.method === 'POST') {
    try {
      const body = await readJson(request);
      const cursor = await publishUserEvent(redis, {
        userId: body.userId,
        idempotencyKey: body.idempotencyKey,
        payload: body.payload,
        maxLength: streamMaxLength,
      });
      return sendJson(response, 202, { accepted: true, cursor });
    } catch (error) {
      if (['BODY_TOO_LARGE', 'Event payload is too large'].includes(error.message)) return sendJson(response, 413, { error: 'Event payload is too large.' });
      if (['Invalid user identity', 'Invalid idempotency key', 'Invalid event payload'].includes(error.message)) return sendJson(response, 400, { error: 'Invalid event request.' });
      console.error('[connectivity-bridge] Event persistence unavailable:', error.message);
      return sendJson(response, 503, { error: 'Event could not be durably accepted.' });
    }
  }
  if (url.pathname.startsWith('/internal/adapters/') && url.pathname.endsWith('/heartbeat') && request.method === 'POST') {
    const name = url.pathname.split('/')[3];
    if (!['api', 'mcp'].includes(name)) return sendJson(response, 400, { error: 'Unknown adapter.' });
    try {
      await redis.set('ryanai:connectivity:adapter:' + name, JSON.stringify({ status: 'ready', checkedAt: Date.now() }), { EX: 45 });
      return sendJson(response, 200, { accepted: true, adapter: name });
    } catch {
      return sendJson(response, 503, { error: 'Adapter heartbeat could not be persisted.' });
    }
  }
  return sendJson(response, 404, { error: 'Not found.' });
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
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
    const serialized = await redis.getDel('ryanai:connectivity:ticket:' + ticket);
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
  let acknowledgedCursor = '0-0';
  let closed = false;
  let reading = false;
  let requestedResume = false;
  let alive = true;
  const sentOrder = [];
  const stream = userStreamKey(ws.userId);
  const cursorKey = userCursorKey(ws.userId);
  const send = (value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };

  ws.on('message', async (raw) => {
    if (raw.length > 64 * 1024) return ws.close(1009, 'Message too large');
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return send({ type: 'error', error: 'Invalid JSON' }); }
    if (message?.type === 'resume' && !requestedResume) {
      requestedResume = true;
      try {
        const saved = await redis.get(cursorKey);
        acknowledgedCursor = saved || '0-0';
        cursor = acknowledgedCursor;
        const oldest = await redis.xRange(stream, '-', '+', { COUNT: 1 });
        if (saved && oldest.length && saved !== '0-0' && compareStreamIds(saved, oldest[0].id) < 0) {
          cursor = '0-0';
          send({ type: 'replay_gap', requestedCursor: saved, oldestAvailable: oldest[0].id, reconcileRequired: true });
        }
        send({ type: 'resumed', cursor: acknowledgedCursor, capabilities: await adapterStatuses() });
        void pump();
      } catch {
        send({ type: 'degraded', dependency: 'redis', retryable: true });
        ws.close(1011, 'Redis unavailable during resume');
      }
      return;
    }
    if (message?.type === 'ack' && typeof message.id === 'string' && /^\d+-\d+$/.test(message.id)) {
      if (!canAcknowledgeNext(sentOrder, message.id)) {
        send({ type: 'error', error: 'Acknowledgements must follow delivery order.' });
        return;
      }
      try {
        await redis.set(cursorKey, message.id, { EX: 60 * 60 * 24 * 30 });
        acknowledgedCursor = message.id;
        sentOrder.shift();
        send({ type: 'acknowledged', id: acknowledgedCursor });
      } catch {
        send({ type: 'degraded', dependency: 'redis', retryable: true });
        ws.close(1011, 'Acknowledgement persistence failed');
      }
      return;
    }
    if (message?.type === 'heartbeat' && typeof message.nonce === 'string' && message.nonce.length <= 128) {
      send({ type: 'heartbeat_ack', nonce: message.nonce, at: Date.now() });
      return;
    }
    send({ type: 'error', error: 'Unsupported bridge message.' });
  });

  async function pump() {
    if (reading || closed || ws.readyState !== WebSocket.OPEN || !requestedResume) return;
    reading = true;
    try {
      while (!closed && ws.readyState === WebSocket.OPEN) {
        if (sentOrder.length >= 500) {
          await delay(250);
          continue;
        }
        const rows = await redis.xRange(stream, '(' + cursor, '+', { COUNT: Math.min(50, 500 - sentOrder.length) });
        if (!rows.length) {
          await delay(400);
          continue;
        }
        for (const entry of rows) {
          if (closed || ws.readyState !== WebSocket.OPEN) break;
          cursor = entry.id;
          let payload;
          try { payload = JSON.parse(entry.message.payload); } catch { payload = { type: 'bridge.event.invalid_payload' }; }
          sentOrder.push(entry.id);
          send({ type: 'event', id: entry.id, data: payload });
        }
      }
    } catch (error) {
      if (!closed) {
        console.error('[connectivity-bridge] Stream reader degraded:', error.message);
        cursor = acknowledgedCursor;
        send({ type: 'degraded', dependency: 'redis', retryable: true });
        setTimeout(() => { if (!closed) void pump(); }, 1000);
      }
    } finally {
      reading = false;
    }
  }

  ws.on('pong', () => { alive = true; });
  const heartbeat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, 25000);
  ws.on('close', () => { closed = true; clearInterval(heartbeat); });
  ws.on('error', () => { closed = true; clearInterval(heartbeat); });
});

server.listen(port, '0.0.0.0', () => console.log('[connectivity-bridge] listening on ' + port));
async function shutdown(signal) {
  console.log('[connectivity-bridge] shutting down:', signal);
  for (const ws of sockets.clients) ws.close(1012, 'Bridge restarting');
  sockets.close();
  await new Promise((resolve) => server.close(resolve));
  await redis.quit().catch(() => undefined);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
