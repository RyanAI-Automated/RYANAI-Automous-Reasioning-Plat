#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import tls from 'node:tls';
import { checkWebSocket } from './check-websocket.js';
import { config } from 'dotenv';

config({ quiet: true });

const execFileAsync = promisify(execFile);
const timeoutMs = Number(
  process.env.INTEGRATION_TIMEOUT_MS || process.env.API_TIMEOUT || 5000,
);
const apiBase = (process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const webBase = (process.env.WEB_URL || process.env.WEB_BASE_URL || 'http://127.0.0.1:9090').replace(/\/+$/, '');
const mcpBase = (process.env.MCP_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');
const adminToken = process.env.TEST_ADMIN_ACCESS_TOKEN?.trim();
const results = [];

async function check(name, operation) {
  try {
    await operation();
    results.push(true);
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push(false);
    console.error(
      `FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json().catch(() => null);
}

async function compose(service, args) {
  await execFileAsync(
    process.platform === 'win32' ? 'docker.exe' : 'docker',
    ['compose', 'exec', '-T', service, ...args],
    { timeout: timeoutMs },
  );
}

function tcpProbe(connectionUrl, label) {
  const parsed = new URL(connectionUrl);
  const port = Number(parsed.port || (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:' ? 5432 : 6379));

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: parsed.hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${label} connection timed out`));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('close', () => clearTimeout(timer));
  });
}

function redisPing(connectionUrl) {
  const parsed = new URL(connectionUrl);
  const secure = parsed.protocol === 'rediss:';
  const port = Number(parsed.port || 6379);
  const commands = [];

  if (parsed.password) {
    commands.push(
      parsed.username
        ? ['AUTH', decodeURIComponent(parsed.username), decodeURIComponent(parsed.password)]
        : ['AUTH', decodeURIComponent(parsed.password)],
    );
  }
  const db = parsed.pathname.replace(/^\//, '');
  if (db && db !== '0') commands.push(['SELECT', db]);
  commands.push(['PING']);

  const request = commands.map((parts) =>
    `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`,
  ).join('');

  return new Promise((resolve, reject) => {
    let settled = false;
    let response = '';
    const socket = secure
      ? tls.connect({ host: parsed.hostname, port, servername: parsed.hostname })
      : net.createConnection({ host: parsed.hostname, port });

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new Error('Redis connection or PING timed out')),
      timeoutMs,
    );

    socket.once('connect', () => socket.write(request));
    if (secure) socket.once('secureConnect', () => socket.write(request));

    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (response.includes('-ERR')) {
        finish(new Error(`Redis error: ${response.trim()}`));
      } else if (response.includes('+PONG')) {
        finish();
      }
    });
    socket.once('error', (error) => {
      if (error.code === 'ETIMEDOUT') {
        finish(new Error('Redis connection or PING timed out'));
      } else {
        finish(error);
      }
    });
  });
}

if (process.env.DATABASE_URL) {
  await check('PostgreSQL connection', () =>
    tcpProbe(process.env.DATABASE_URL, 'PostgreSQL'),
  );
} else {
  await check('PostgreSQL connection', () =>
    compose('postgres', ['pg_isready', '-U', 'ryanai', '-d', 'ryanai_db']),
  );
}

if (process.env.REDIS_URL) {
  await check('Redis connection', () => redisPing(process.env.REDIS_URL));
} else {
  await check('Redis connection', () =>
    compose('redis', ['redis-cli', '--no-auth-warning', 'ping']),
  );
}

await check('API health and dependency status', async () => {
  const body = await json(`${apiBase}/health`);
  if (body?.status !== 'online') throw new Error('API is not online');
  if (!body?.services?.database || !body?.services?.redis) {
    throw new Error('API dependencies are unhealthy');
  }
});

await check('Web health endpoint', () => json(`${webBase}/health`));

await check('Web document', async () => {
  const response = await fetch(`${webBase}/`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
});

await check('MCP health endpoint', async () => {
  const body = await json(`${mcpBase}/health`);
  if (body?.status !== 'ok') throw new Error('MCP is unhealthy');
});

await check('WebSocket endpoint rejects anonymous upgrades', () =>
  checkWebSocket(apiBase, timeoutMs, { expectedStatus: 401 }),
);

let skipped = 0;
if (adminToken) {
  await check('Authenticated admin WebSocket accepts upgrades', () =>
    checkWebSocket(apiBase, timeoutMs, { token: adminToken }),
  );
} else {
  skipped++;
  console.log(
    'SKIP Authenticated admin WebSocket: set TEST_ADMIN_ACCESS_TOKEN to a Supabase admin access token',
  );
}
const passed = results.filter(Boolean).length;
console.log(`\nIntegration checks: ${passed}/${results.length} passed; ${skipped} skipped`);
if (passed !== results.length) process.exitCode = 1;
