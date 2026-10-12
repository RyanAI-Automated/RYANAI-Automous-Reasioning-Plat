import {
  apiUrl,
  webUrl,
  apiHealthUrl,
  mcpHealthUrl,
} from './health-config.mjs';
import { checkWebSocket } from './check-websocket.js';
import { Pool } from 'pg';
import { createClient } from 'redis';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const timeoutMs = Number(process.env.INTEGRATION_TIMEOUT_MS || 5000);
const adminToken = process.env.TEST_ADMIN_ACCESS_TOKEN?.trim();
let skipped = 0;
const results: { name: string; error?: string }[] = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`PASS ${name}`);
    results.push({ name });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${name}: ${message}`);
    results.push({ name, error: message });
  }
}

async function checkHttp(
  name: string,
  url: string,
  expectedContentType?: string,
): Promise<void> {
  await check(name, async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    if (
      expectedContentType &&
      !response.headers.get('content-type')?.includes(expectedContentType)
    ) {
      throw new Error(`Expected content type ${expectedContentType}`);
    }
  });
}

async function main(): Promise<void> {
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      'Set DATABASE_URL and REDIS_URL in .env before running integration tests',
    );
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    max: 1,
  });
  const redis = createClient({
    url: redisUrl,
    socket: { connectTimeout: timeoutMs, reconnectStrategy: false },
  });
  redis.on('error', (error) =>
    console.error(`Redis client error: ${error.message}`),
  );

  try {
    await check('PostgreSQL connection', async () => {
      await pool.query('SELECT 1');
    });

    await check('Redis connection', async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            await redis.connect();
            const response = await redis.ping();
            if (response !== 'PONG')
              throw new Error(`Unexpected Redis response: ${response}`);
          })(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Redis connection or PING timed out')),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        if (redis.isOpen) redis.destroy();
      }
    });

    await checkHttp('API health endpoint', apiHealthUrl, 'application/json');
    await check('API PostgreSQL and Redis health', async () => {
      const response = await fetch(apiHealthUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok)
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const health = await response.json();
      if (health.status !== 'online')
        throw new Error(`API status is ${health.status ?? 'unknown'}`);
      if (health.services?.database !== true)
        throw new Error('PostgreSQL is not connected');
      if (health.services?.redis !== true)
        throw new Error('Redis is not connected');
    });
    await checkHttp('Web frontend health endpoint', `${webUrl}/health`);
    await checkHttp('Web frontend document', webUrl, 'text/html');
    if (mcpHealthUrl)
      await checkHttp('MCP health endpoint', mcpHealthUrl, 'application/json');

    await check('WebSocket endpoint rejects anonymous upgrades', () =>
      checkWebSocket(apiUrl, timeoutMs, { expectedStatus: 401 }),
    );
    if (adminToken) {
      await check('Authenticated admin WebSocket accepts upgrades', () =>
        checkWebSocket(apiUrl, timeoutMs, { token: adminToken }),
      );
    } else {
      skipped++;
      console.log(
        'SKIP Authenticated WebSocket: set TEST_ADMIN_ACCESS_TOKEN to a Supabase admin access token',
      );
    }
  } finally {
    if (redis.isOpen) redis.destroy();
    await pool.end();
  }

  const failed = results.filter((result) => result.error);
  console.log(
    `\nIntegration checks: ${results.length - failed.length}/${results.length} passed; ${skipped} skipped`,
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
