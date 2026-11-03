import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const SECRET = 'bridge-test-ticket-secret-32-characters-minimum';
const ISSUER = 'bridge-test-issuer-token-32-characters-minimum';
const API_ADAPTER = 'bridge-test-api-adapter-token-32-characters-minimum';
const MCP_ADAPTER = 'bridge-test-mcp-adapter-token-32-characters-minimum';
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
  const child = spawn('redis-server', [
    '--bind', '127.0.0.1', '--port', String(port), '--protected-mode', 'no',
    '--dir', directory, '--appendonly', 'yes', '--appendfsync', 'always',
    '--save', '', '--daemonize', 'no',
  ], { stdio: 'ignore' });
  return child;
}
function startBridge(port, redisPort) {
  return spawn(process.execPath, ['bridge-runtime/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BRIDGE_HOST: '127.0.0.1',
      BRIDGE_PORT: String(port),
      REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      BRIDGE_TICKET_SECRET: SECRET,
      BRIDGE_ISSUER_TOKEN: ISSUER,
      BRIDGE_API_ADAPTER_TOKEN: API_ADAPTER,
      BRIDGE_MCP_ADAPTER_TOKEN: MCP_ADAPTER,
      BRIDGE_ALLOWED_ORIGINS: '',
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
async function health(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(1500) });
  return response.ok;
}
async function ticket(port, subject = 'bridge-test-user', ttlSeconds = 60) {
  const response = await fetch(`http://127.0.0.1:${port}/internal/tickets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ISSUER}`, 'content-type': 'application/json' },
    body: JSON.stringify({ subject, topics: ['tasks'], ttlSeconds }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).ticket;
}
function frame(type, data) {
  return JSON.stringify({ version: 1, id: crypto.randomUUID(), sentAt: Date.now(), message: { type, data } });
}
async function openSocket(port, signedTicket) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(frame('hello', { ticket: signedTicket }));
  const ready = await nextMessage(socket, (value) => value.message?.type === 'ready');
  return { socket, ready: ready.message.data };
}
function nextMessage(socket, predicate, timeout = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for bridge frame')); }, timeout);
    const onMessage = (raw) => {
      let value;
      try { value = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(value)) return;
      cleanup();
      resolve(value);
    };
    const onClose = () => { cleanup(); reject(new Error('Bridge socket closed before expected frame')); };
    function cleanup() { clearTimeout(timer); socket.off('message', onMessage); socket.off('close', onClose); }
    socket.on('message', onMessage);
    socket.once('close', onClose);
  });
}
async function publish(port, idempotencyKey, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/internal/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_ADAPTER}`, 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'bridge-test-user', topic: 'tasks', idempotencyKey, payload }),
  });
  assert.equal(response.status, 202);
  return response.json();
}
async function heartbeat(port, name) {
  const response = await fetch(`http://127.0.0.1:${port}/internal/adapters/${name}/heartbeat`, {
    method: 'POST', headers: { authorization: `Bearer ${name === 'api' ? API_ADAPTER : MCP_ADAPTER}` },
  });
  assert.equal(response.status, 200);
}

test('bridge recovers from independent adapter failures, duplicate publish, bridge and Redis restarts, and expired tickets', { skip: !hasRedisServer && 'redis-server is required for bridge integration tests' }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ryanai-bridge-'));
  const redisPort = await freePort();
  const bridgePort = await freePort();
  let redis = startRedis(redisPort, directory);
  let bridge = startBridge(bridgePort, redisPort);
  const base = `http://127.0.0.1:${bridgePort}`;
  try {
    await waitFor(() => health(bridgePort));

    await t.test('API and MCP adapters degrade independently', async () => {
      let opened = await openSocket(bridgePort, await ticket(bridgePort));
      assert.equal(opened.ready.capabilities.api, 'unavailable');
      assert.equal(opened.ready.capabilities.mcp, 'unavailable');
      opened.socket.close();
      await heartbeat(bridgePort, 'api');
      opened = await openSocket(bridgePort, await ticket(bridgePort));
      assert.equal(opened.ready.capabilities.api, 'ready');
      assert.equal(opened.ready.capabilities.mcp, 'unavailable');
      opened.socket.close();
      await heartbeat(bridgePort, 'mcp');
      opened = await openSocket(bridgePort, await ticket(bridgePort));
      assert.equal(opened.ready.capabilities.api, 'ready');
      assert.equal(opened.ready.capabilities.mcp, 'ready');
      opened.socket.close();

      const apiCannotPublishSystem = await fetch(`http://127.0.0.1:${bridgePort}/internal/events`, {
        method: 'POST',
        headers: { authorization: `Bearer ${API_ADAPTER}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'system', topic: 'agent.status', idempotencyKey: 'forbidden-api', payload: {} }),
      });
      assert.equal(apiCannotPublishSystem.status, 403);
      const mcpCannotPublishUser = await fetch(`http://127.0.0.1:${bridgePort}/internal/events`, {
        method: 'POST',
        headers: { authorization: `Bearer ${MCP_ADAPTER}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'bridge-test-user', topic: 'tasks', idempotencyKey: 'forbidden-mcp', payload: {} }),
      });
      assert.equal(mcpCannotPublishUser.status, 403);
    });

    await t.test('duplicate event publication is idempotent and delivered once', async () => {
      const opened = await openSocket(bridgePort, await ticket(bridgePort));
      opened.socket.send(frame('subscribe', { topics: ['tasks'] }));
      const first = await publish(bridgePort, 'same-event-key', { sequence: 1 });
      const duplicate = await publish(bridgePort, 'same-event-key', { sequence: 1 });
      assert.equal(first.cursor, duplicate.cursor);
      const event = await nextMessage(opened.socket, (value) => value.message?.type === 'event');
      assert.equal(event.message.data.eventId, 'same-event-key');
      opened.socket.send(frame('ack', { eventId: event.message.data.eventId, cursor: event.message.data.cursor }));
      await delay(350);
      opened.socket.close();
    });

    await t.test('bridge restart replays unacknowledged durable events', async () => {
      await publish(bridgePort, 'bridge-restart-event', { sequence: 2 });
      await stop(bridge);
      bridge = startBridge(bridgePort, redisPort);
      await waitFor(() => health(bridgePort));
      const opened = await openSocket(bridgePort, await ticket(bridgePort));
      opened.socket.send(frame('subscribe', { topics: ['tasks'] }));
      const event = await nextMessage(opened.socket, (value) => value.message?.type === 'event' && value.message.data.eventId === 'bridge-restart-event');
      assert.equal(event.message.data.payload.sequence, 2);
      opened.socket.close();
    });

    await t.test('Redis restart recovers the stream from AOF and bridge reconnects', async () => {
      await publish(bridgePort, 'redis-restart-event', { sequence: 3 });
      await stop(redis);
      await delay(500);
      redis = startRedis(redisPort, directory);
      await waitFor(() => health(bridgePort), 20000);
      const opened = await openSocket(bridgePort, await ticket(bridgePort));
      opened.socket.send(frame('subscribe', { topics: ['tasks'] }));
      const event = await nextMessage(opened.socket, (value) => value.message?.type === 'event' && value.message.data.eventId === 'redis-restart-event', 12000);
      assert.equal(event.message.data.payload.sequence, 3);
      opened.socket.close();
    });


    await t.test('connection tickets are single-use and cannot be replayed', async () => {
      const oneTime = await ticket(bridgePort);
      const first = await openSocket(bridgePort, oneTime);
      first.socket.close();
      const replay = new WebSocket(`ws://127.0.0.1:${bridgePort}/ws`);
      await new Promise((resolve, reject) => { replay.once('open', resolve); replay.once('error', reject); });
      replay.send(frame('hello', { ticket: oneTime }));
      const closeCode = await new Promise((resolve) => replay.once('close', (code) => resolve(code)));
      assert.equal(closeCode, 1008);
    });

    await t.test('expired tickets are rejected', async () => {
      const expired = await ticket(bridgePort, 'expired-user', 10);
      await delay(10500);
      const socket = new WebSocket(`ws://127.0.0.1:${bridgePort}/ws`);
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      socket.send(frame('hello', { ticket: expired }));
      const close = await new Promise((resolve) => socket.once('close', (code) => resolve(code)));
      assert.equal(close, 1008);
    });
  } finally {
    await stop(bridge);
    await stop(redis);
    await rm(directory, { recursive: true, force: true });
  }
});
