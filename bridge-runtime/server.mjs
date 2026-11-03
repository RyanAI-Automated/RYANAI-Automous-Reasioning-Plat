import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from 'redis';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.BRIDGE_PORT || process.env.PORT || 8787);
const HOST = process.env.BRIDGE_HOST || '0.0.0.0';
const REDIS_URL = process.env.REDIS_URL;
const TICKET_SECRET = process.env.BRIDGE_TICKET_SECRET || '';
const ISSUER_TOKEN = process.env.BRIDGE_ISSUER_TOKEN || '';
const ADAPTER_TOKEN = process.env.BRIDGE_ADAPTER_TOKEN || '';
const ALLOWED_ORIGINS = new Set((process.env.BRIDGE_ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean));
const MAX_TOPICS = 64;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const STREAM_MAXLEN = 10000;
const HEARTBEAT_MS = 25000;
const POLL_MS = 500;
const TICKET_TTL_MAX = 120;
const CURSOR_PREFIX = 'ryanai:bridge:cursor:';
const ADAPTER_PREFIX = 'ryanai:bridge:adapter:';
const STREAM_PREFIX = 'ryanai:bridge:stream:';

if (!REDIS_URL) throw new Error('REDIS_URL is required; bridge refuses to start without durable storage.');
if (TICKET_SECRET.length < 32 || ISSUER_TOKEN.length < 32 || ADAPTER_TOKEN.length < 32) {
  throw new Error('Bridge ticket, issuer, and adapter secrets must each contain at least 32 characters.');
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Invalid BRIDGE_PORT.');

const redis = createClient({ url: REDIS_URL, socket: { reconnectStrategy: (retries) => Math.min(250 * 2 ** Math.min(retries, 6), 10000) } });
redis.on('error', (error) => console.error('bridge.redis.error', { message: error.message }));
await redis.connect();

const ticketKey = (jti) => 'ryanai:bridge:ticket:' + jti;
const streamKey = (topic) => STREAM_PREFIX + Buffer.from(topic).toString('base64url');
const cursorKey = (subject, topic) => CURSOR_PREFIX + createHmac('sha256', TICKET_SECRET).update(subject).digest('hex') + ':' + Buffer.from(topic).toString('base64url');
const adapterKey = (name) => ADAPTER_PREFIX + name;

function safeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function bearer(request) {
  const value = request.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : '';
}
function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('INVALID_JSON')); }
    });
    request.on('error', reject);
  });
}
function signTicket(claims) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', TICKET_SECRET).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}
function verifyTicket(ticket) {
  if (typeof ticket !== 'string' || ticket.length > 4096) throw new Error('INVALID_TICKET');
  const parts = ticket.split('.');
  const encoded = parts[0], supplied = parts[1];
  if (!encoded || !supplied || parts.length !== 2) throw new Error('INVALID_TICKET');
  const expected = createHmac('sha256', TICKET_SECRET).update(encoded).digest('base64url');
  if (!safeEqual(supplied, expected)) throw new Error('INVALID_TICKET');
  let claims;
  try { claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw new Error('INVALID_TICKET'); }
  if (!claims || typeof claims.sub !== 'string' || !claims.sub || !Array.isArray(claims.topics) ||
      typeof claims.jti !== 'string' || !Number.isInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000) ||
      claims.topics.length < 1 || claims.topics.length > MAX_TOPICS ||
      !claims.topics.every((topic) => validTopic(topic))) throw new Error('INVALID_TICKET');
  return claims;
}
function validTopic(topic) {
  return typeof topic === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(topic);
}
function makeEnvelope(message) {
  return { version: 1, id: randomUUID(), sentAt: Date.now(), message };
}

const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://bridge.local');
  if (request.method === 'GET' && url.pathname === '/health/live') return json(response, 200, { status: 'alive', service: 'ryanai-connectivity-bridge' });
  if (request.method === 'GET' && url.pathname === '/health/ready') {
    try { await redis.ping(); return json(response, 200, { status: 'ready', dependencies: { redis: 'ready' } }); }
    catch { return json(response, 503, { status: 'degraded', dependencies: { redis: 'unavailable' } }); }
  }
  if (request.method !== 'POST') return json(response, 404, { error: 'Not found' });
  if (url.pathname === '/internal/tickets') {
    if (!safeEqual(bearer(request), ISSUER_TOKEN)) return json(response, 401, { error: 'Unauthorized' });
    try {
      const body = await readBody(request);
      const subject = typeof body.subject === 'string' ? body.subject : '';
      const topics = body.topics, ttl = Number(body.ttlSeconds || 60);
      if (!subject || subject.length > 256 || !Array.isArray(topics) || topics.length < 1 || topics.length > MAX_TOPICS ||
          !topics.every(validTopic) || !Number.isInteger(ttl) || ttl < 10 || ttl > TICKET_TTL_MAX) return json(response, 400, { error: 'Invalid ticket request' });
      const now = Math.floor(Date.now() / 1000);
      const claims = { sub: subject, topics: [...new Set(topics)], iat: now, exp: now + ttl, jti: randomUUID() };
      return json(response, 201, { ticket: signTicket(claims), expiresAt: claims.exp });
    } catch (error) {
      return json(response, 400, { error: error.message === 'BODY_TOO_LARGE' ? 'Request too large' : 'Invalid request' });
    }
  }
  if (url.pathname === '/internal/events') {
    if (!safeEqual(bearer(request), ADAPTER_TOKEN)) return json(response, 401, { error: 'Unauthorized' });
    try {
      const body = await readBody(request);
      if (!validTopic(body.topic) || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 1 ||
          body.idempotencyKey.length > 128 || !Object.hasOwn(body, 'payload')) return json(response, 400, { error: 'Invalid event' });
      const payload = JSON.stringify(body.payload);
      if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) return json(response, 413, { error: 'Payload too large' });
      const script = [
        "if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('GET', KEYS[1]) end",
        "local id = redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[3], '*', 'eventId', ARGV[1], 'payload', ARGV[2], 'occurredAt', ARGV[4])",
        "redis.call('SET', KEYS[1], id, 'EX', 86400)",
        "return id"
      ].join('\\n');
      const streamId = await redis.eval(script, {
        keys: ['ryanai:bridge:dedupe:' + Buffer.from(body.topic).toString('base64url') + ':' + Buffer.from(body.idempotencyKey).toString('base64url'), streamKey(body.topic)],
        arguments: [body.idempotencyKey, payload, String(STREAM_MAXLEN), String(Date.now())],
      });
      return json(response, 202, { accepted: true, eventId: body.idempotencyKey, cursor: streamId });
    } catch (error) {
      console.error('bridge.publish.error', { message: error.message });
      return json(response, 503, { error: 'Event could not be durably accepted' });
    }
  }
  if (url.pathname.startsWith('/internal/adapters/') && url.pathname.endsWith('/heartbeat')) {
    if (!safeEqual(bearer(request), ADAPTER_TOKEN)) return json(response, 401, { error: 'Unauthorized' });
    const name = url.pathname.split('/')[3];
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(name)) return json(response, 400, { error: 'Invalid adapter name' });
    await redis.set(adapterKey(name), JSON.stringify({ status: 'ready', checkedAt: Date.now() }), { EX: 45 });
    return json(response, 200, { accepted: true, adapter: name });
  }
  return json(response, 404, { error: 'Not found' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', 'http://bridge.local');
  if (url.pathname !== '/ws') return socket.destroy();
  const origin = request.headers.origin;
  if (typeof origin === 'string' && !ALLOWED_ORIGINS.has(origin)) { socket.write('HTTP/1.1 403 Forbidden\\r\\n\\r\\n'); return socket.destroy(); }
  if (ALLOWED_ORIGINS.size > 0 && !origin) { socket.write('HTTP/1.1 403 Forbidden\\r\\n\\r\\n'); return socket.destroy(); }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

const connections = new Set();
wss.on('connection', (ws) => {
  const connection = { ws, claims: null, subscriptions: new Map(), delivered: new Map(), scanBusy: false, alive: true, authenticated: false, closed: false };
  connections.add(connection);
  const authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
  ws.on('pong', () => { connection.alive = true; });
  ws.on('message', async (raw) => {
    let envelope;
    try { envelope = JSON.parse(raw.toString()); } catch { ws.close(1007, 'Invalid JSON'); return; }
    if (!envelope || envelope.version !== 1 || !envelope.message || typeof envelope.message.type !== 'string' || !envelope.message.data) {
      ws.close(1008, 'Invalid protocol envelope'); return;
    }
    const { type, data } = envelope.message;
    try {
      if (!connection.authenticated) {
        if (type !== 'hello') throw new Error('AUTH_REQUIRED');
        const claims = verifyTicket(data.ticket);
        const consumed = await redis.set(ticketKey(claims.jti), 'used', { NX: true, EX: Math.max(1, claims.exp - Math.floor(Date.now() / 1000)) });
        if (consumed !== 'OK') throw new Error('TICKET_REPLAYED');
        connection.claims = claims;
        connection.authenticated = true;
        clearTimeout(authTimer);
        const capabilities = { bridge: 'ready', redis: 'ready' };
        for (const name of ['api', 'mcp']) capabilities[name] = await redis.exists(adapterKey(name)) ? 'ready' : 'unavailable';
        ws.send(JSON.stringify(makeEnvelope({ type: 'ready', data: { connectionId: randomUUID(), capabilities } })));
        return;
      }
      if (type === 'heartbeat') {
        ws.send(JSON.stringify(makeEnvelope({ type: 'heartbeat_ack', data: { nonce: data.nonce, serverTime: Date.now() } })));
      } else if (type === 'subscribe') {
        if (!Array.isArray(data.topics) || data.topics.length < 1 || data.topics.length > MAX_TOPICS ||
            !data.topics.every((topic) => connection.claims.topics.includes(topic))) throw new Error('SUBSCRIPTION_NOT_ALLOWED');
        for (const topic of data.topics) {
          const saved = data.after || await redis.get(cursorKey(connection.claims.sub, topic)) || '0-0';
          connection.subscriptions.set(topic, { scanCursor: saved, ackCursor: saved });
        }
      } else if (type === 'ack') {
        const delivered = connection.delivered.get(data.eventId);
        if (!delivered || delivered.cursor !== data.cursor) throw new Error('ACK_NOT_DELIVERED');
        await redis.set(cursorKey(connection.claims.sub, delivered.topic), delivered.cursor);
        const subscription = connection.subscriptions.get(delivered.topic);
        if (subscription && delivered.cursor > subscription.ackCursor) subscription.ackCursor = delivered.cursor;
        connection.delivered.delete(data.eventId);
      } else if (type === 'publish') {
        throw new Error('CLIENT_PUBLISH_NOT_ALLOWED');
      } else throw new Error('UNKNOWN_MESSAGE');
    } catch (error) {
      const code = error.message || 'BRIDGE_ERROR';
      ws.send(JSON.stringify(makeEnvelope({ type: 'error', data: { code, message: 'Bridge request rejected', retryable: false } })));
      if (['AUTH_REQUIRED', 'INVALID_TICKET', 'TICKET_REPLAYED'].includes(code)) ws.close(1008, 'Authentication failed');
    }
  });
  ws.on('close', () => {
    connection.closed = true; clearTimeout(authTimer); connections.delete(connection);
    connection.subscriptions.clear(); connection.delivered.clear();
  });
  ws.on('error', (error) => console.error('bridge.websocket.error', { message: error.message }));
});

async function pollConnections() {
  for (const connection of connections) {
    if (connection.closed || !connection.authenticated || connection.scanBusy || connection.ws.readyState !== WebSocket.OPEN) continue;
    connection.scanBusy = true;
    try {
      for (const [topic, state] of connection.subscriptions) {
        const rows = await redis.xRange(streamKey(topic), '(' + state.scanCursor, '+', { COUNT: 100 });
        for (const row of rows) {
          if (connection.ws.readyState !== WebSocket.OPEN) break;
          const payload = JSON.parse(row.message.payload);
          const eventId = row.message.eventId;
          state.scanCursor = row.id;
          connection.delivered.set(eventId, { topic, cursor: row.id });
          connection.ws.send(JSON.stringify(makeEnvelope({ type: 'event', data: { eventId, cursor: row.id, topic, payload, occurredAt: Number(row.message.occurredAt) } })));
        }
      }
    } catch (error) {
      console.error('bridge.delivery.error', { message: error.message });
      if (connection.ws.readyState === WebSocket.OPEN) connection.ws.send(JSON.stringify(makeEnvelope({ type: 'degraded', data: { dependency: 'redis', state: 'unavailable', retryable: true } })));
    } finally { connection.scanBusy = false; }
  }
}
const pollTimer = setInterval(() => void pollConnections(), POLL_MS);
const heartbeatTimer = setInterval(() => {
  for (const connection of connections) {
    if (!connection.alive) { connection.ws.terminate(); continue; }
    connection.alive = false; connection.ws.ping();
  }
}, HEARTBEAT_MS);

httpServer.listen(PORT, HOST, () => console.log('bridge.listening', { host: HOST, port: PORT }));
async function shutdown(signal) {
  console.log('bridge.shutdown', { signal });
  clearInterval(pollTimer); clearInterval(heartbeatTimer);
  for (const connection of connections) connection.ws.close(1012, 'Bridge restarting');
  wss.close(); httpServer.close();
  await redis.quit().catch(() => undefined);
}
process.once('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));
