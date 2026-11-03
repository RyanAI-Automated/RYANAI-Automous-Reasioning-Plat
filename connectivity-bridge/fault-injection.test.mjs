import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const API_ADAPTER = 'bridge-test-api-adapter-token-32-characters-minimum';
const MCP_ADAPTER = 'bridge-test-mcp-adapter-token-32-characters-minimum';
const SESSION = 'mock-supabase-session-token';
const hasRedisServer = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
async function waitFor(fn, timeout = 15000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(150);
  }
  throw last || new Error('Timed out waiting for service readiness');
}
function startRedis(port, directory) {
  return spawn('redis-server', [
    '--bind', '127.0.0.1', '--port', String(port), '--protected-mode', 'no',
    '--dir', directory, '--appendonly', 'yes', '--appendfsync', 'always',
    '--save', '', '--daemonize', 'no',
  ], { stdio: 'ignore' });
}
function startBridge(port, redisPort, authPort) {
  return spawn(process.execPath, ['connectivity-bridge/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BRIDGE_PORT: String(port),
      REDIS_URL: 'redis://127.0.0.1:' + redisPort,
      SUPABASE_URL: 'http://127.0.0.1:' + authPort,
      SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
      BRIDGE_API_ADAPTER_TOKEN: API_ADAPTER,
      BRIDGE_MCP_ADAPTER_TOKEN: MCP_ADAPTER,
      BRIDGE_TICKET_TTL_SECONDS: '5',
      BRIDGE_STREAM_MAX_LENGTH: '1000',
      CORS_ORIGINS: '',
    },
    stdio: 'ignore',
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
async function isReady(port) {
  const response = await fetch('http://127.0.0.1:' + port + '/readyz', { signal: AbortSignal.timeout(1200) });
  return response.ok;
}
async function issueTicket(port) {
  const response = await fetch('http://127.0.0.1:' + port + '/v1/ticket', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + SESSION },
  });
  assert.equal(response.status, 201);
  return (await response.json()).ticket;
}
function createMessageQueue(socket) {
  const buffered = [];
  const waiters = [];
  socket.on('message', (raw) => {
    let value;
    try { value = JSON.parse(raw.toString()); } catch { return; }
    const index = waiters.findIndex((waiter) => waiter.predicate(value));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(value);
    } else buffered.push(value);
  });
  return (predicate, timeout = 8000) => {
    const index = buffered.findIndex(predicate);
    if (index >= 0) return Promise.resolve(buffered.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate, resolve, reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('Timed out waiting for bridge frame'));
        }, timeout),
      };
      waiters.push(waiter);
    });
  };
}
async function openSocket(port, suppliedTicket) {
  const ticket = suppliedTicket || await issueTicket(port);
  const socket = new WebSocket('ws://127.0.0.1:' + port + '/v1/socket');
  const next = createMessageQueue(socket);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'hello', ticket }));
  await next((value) => value.type === 'authenticated');
  socket.send(JSON.stringify({ type: 'resume' }));
  const resumed = await next((value) => value.type === 'resumed');
  return { socket, capabilities: resumed.capabilities, next };
}
async function publish(port, idempotencyKey, payload) {
  const response = await fetch('http://127.0.0.1:' + port + '/internal/events', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + API_ADAPTER, 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'bridge-test-user', idempotencyKey, payload }),
  });
  assert.equal(response.status, 202);
  return response.json();
}
async function heartbeat(port, name) {
  const response = await fetch('http://127.0.0.1:' + port + '/internal/adapters/' + name + '/heartbeat', {
    method: 'POST', headers: { authorization: 'Bearer ' + (name === 'api' ? API_ADAPTER : MCP_ADAPTER) },
  });
  assert.equal(response.status, 200);
}

test('connectivity bridge recovers across adapter, process, Redis and ticket failures', {
  skip: !hasRedisServer && 'redis-server is required for bridge integration tests',
  timeout: 120000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ryanai-connectivity-bridge-'));
  const redisPort = await freePort();
  const authPort = await freePort();
  const bridgePort = await freePort();
  const authServer = createServer((request, response) => {
    if (request.url !== '/auth/v1/user' || request.headers.authorization !== 'Bearer ' + SESSION ||
        request.headers.apikey !== 'test-publishable-key') {
      response.writeHead(401); response.end(); return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'bridge-test-user', is_anonymous: false }));
  });
  await new Promise((resolve) => authServer.listen(authPort, '127.0.0.1', resolve));
  let redis = startRedis(redisPort, directory);
  let bridge = startBridge(bridgePort, redisPort, authPort);
  try {
    await waitFor(() => isReady(bridgePort));

    await t.test('API and MCP capability heartbeats degrade independently', async () => {
      let opened = await openSocket(bridgePort);
      assert.equal(opened.capabilities.api, 'unavailable');
      assert.equal(opened.capabilities.mcp, 'unavailable');
      opened.socket.close();
      const wrongApiHeartbeat = await fetch('http://127.0.0.1:' + bridgePort + '/internal/adapters/api/heartbeat', {
        method: 'POST', headers: { authorization: 'Bearer ' + MCP_ADAPTER },
      });
      assert.equal(wrongApiHeartbeat.status, 401);
      const deniedMcpPublish = await fetch('http://127.0.0.1:' + bridgePort + '/internal/events', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + MCP_ADAPTER, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'bridge-test-user', idempotencyKey: 'mcp-must-not-publish', payload: {} }),
      });
      assert.equal(deniedMcpPublish.status, 401);
      await heartbeat(bridgePort, 'api');
      opened = await openSocket(bridgePort);
      assert.equal(opened.capabilities.api, 'ready');
      assert.equal(opened.capabilities.mcp, 'unavailable');
      opened.socket.close();
      await heartbeat(bridgePort, 'mcp');
      opened = await openSocket(bridgePort);
      assert.equal(opened.capabilities.api, 'ready');
      assert.equal(opened.capabilities.mcp, 'ready');
      opened.socket.close();
    });

    await t.test('duplicate publish is idempotent and acknowledgements advance in order', async () => {
      const opened = await openSocket(bridgePort);
      const first = await publish(bridgePort, 'duplicate-key', { sequence: 1 });
      const duplicate = await publish(bridgePort, 'duplicate-key', { sequence: 1 });
      assert.equal(first.cursor, duplicate.cursor);
      await publish(bridgePort, 'second-key', { sequence: 2 });
      const event1 = await opened.next((value) => value.type === 'event');
      const event2 = await opened.next((value) => value.type === 'event');
      assert.equal(event1.data.sequence, 1);
      assert.equal(event2.data.sequence, 2);
      opened.socket.send(JSON.stringify({ type: 'ack', id: event2.id }));
      const rejected = await opened.next((value) => value.type === 'error');
      assert.match(rejected.error, /delivery order/i);
      opened.socket.send(JSON.stringify({ type: 'ack', id: event1.id }));
      await opened.next((value) => value.type === 'acknowledged' && value.id === event1.id);
      opened.socket.send(JSON.stringify({ type: 'ack', id: event2.id }));
      await opened.next((value) => value.type === 'acknowledged' && value.id === event2.id);
      opened.socket.close();
    });

    await t.test('bridge restart replays unacknowledged events from Redis', async () => {
      await publish(bridgePort, 'bridge-restart-key', { sequence: 2 });
      const before = await openSocket(bridgePort);
      const unacked = await before.next( (value) => value.type === 'event' && value.data.sequence === 2);
      assert.ok(unacked.id);
      await stop(bridge);
      before.socket.close();
      bridge = startBridge(bridgePort, redisPort, authPort);
      await waitFor(() => isReady(bridgePort));
      const after = await openSocket(bridgePort);
      const replay = await after.next( (value) => value.type === 'event' && value.id === unacked.id);
      assert.equal(replay.data.sequence, 2);
      after.socket.close();
    });

    await t.test('Redis AOF recovery restores unacknowledged events after Redis restart', async () => {
      await publish(bridgePort, 'redis-restart-key', { sequence: 3 });
      const before = await openSocket(bridgePort);
      const unacked = await before.next( (value) => value.type === 'event' && value.data.sequence === 3);
      before.socket.close();
      await stop(redis);
      await delay(500);
      redis = startRedis(redisPort, directory);
      await waitFor(() => isReady(bridgePort), 25000);
      const after = await openSocket(bridgePort);
      const replay = await after.next( (value) => value.type === 'event' && value.id === unacked.id, 15000);
      assert.equal(replay.data.sequence, 3);
      after.socket.close();
    });

    await t.test('application heartbeat receives an acknowledgement', async () => {
      const opened = await openSocket(bridgePort);
      opened.socket.send(JSON.stringify({ type: 'heartbeat', nonce: 'heartbeat-test-1' }));
      const ack = await opened.next( (value) => value.type === 'heartbeat_ack');
      assert.equal(ack.nonce, 'heartbeat-test-1');
      opened.socket.close();
    });

    await t.test('one-time connection tickets cannot be replayed', async () => {
      const ticket = await issueTicket(bridgePort);
      const first = await openSocket(bridgePort, ticket);
      first.socket.close();
      const replay = new WebSocket('ws://127.0.0.1:' + bridgePort + '/v1/socket');
      await new Promise((resolve, reject) => { replay.once('open', resolve); replay.once('error', reject); });
      const closed = new Promise((resolve) => replay.once('close', (code) => resolve(code)));
      replay.send(JSON.stringify({ type: 'hello', ticket }));
      const closeCode = await closed;
      assert.equal(closeCode, 1008);
    });

    await t.test('expired one-time tickets cannot open a socket', async () => {
      const expired = await issueTicket(bridgePort);
      await delay(5500);
      const socket = new WebSocket('ws://127.0.0.1:' + bridgePort + '/v1/socket');
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      const closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)));
      socket.send(JSON.stringify({ type: 'hello', ticket: expired }));
      const closeCode = await closed;
      assert.equal(closeCode, 1008);
    });
  } finally {
    await stop(bridge);
    await stop(redis);
    await new Promise((resolve) => authServer.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
