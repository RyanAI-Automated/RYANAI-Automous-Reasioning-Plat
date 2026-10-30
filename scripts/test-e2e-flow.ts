import { apiUrl, webUrl, apiHealthUrl } from './health-config.mjs';
import { checkWebSocket } from './check-websocket.js';

const timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 5000);
const userToken = process.env.TEST_USER_ACCESS_TOKEN?.trim();
const adminToken = process.env.TEST_ADMIN_ACCESS_TOKEN?.trim();
let skipped = 0;
const results: { name: string; error?: string }[] = [];

async function test(name: string, run: () => Promise<void>): Promise<void> {
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

/**
 * Check HTTP and WebSocket access, skipping authenticated checks without tokens.
 * Report the results and set a failing exit code if any executed check fails.
 */
async function main(): Promise<void> {
  await test('API health endpoint', async () => {
    const response = await fetch(apiHealthUrl, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    if (health.status !== 'online')
      throw new Error('API did not report online');
  });

  await test('Frontend is served', async () => {
    const response = await fetch(webUrl, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Frontend response is not HTML');
    }
  });

  await test('Reasoning endpoint rejects anonymous requests', async () => {
    const response = await fetch(`${apiUrl}/api/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '  ' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 401) {
      throw new Error(`Expected HTTP 401, received HTTP ${response.status}`);
    }
  });

  await test('WebSocket endpoint rejects anonymous upgrades', () =>
    checkWebSocket(apiUrl, timeoutMs, { expectedStatus: 401 }));

  if (userToken) {
    await test('Authenticated reasoning rejects empty prompts', async () => {
      const response = await fetch(`${apiUrl}/api/reason`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ prompt: '  ' }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 400)
        throw new Error(`Expected HTTP 400, received HTTP ${response.status}`);
    });
  } else {
    skipped++;
    console.log(
      'SKIP Authenticated reasoning: set TEST_USER_ACCESS_TOKEN to a Supabase user access token',
    );
  }

  if (adminToken) {
    await test('Authenticated admin WebSocket accepts upgrades', () =>
      checkWebSocket(apiUrl, timeoutMs, { token: adminToken }));
  } else {
    skipped++;
    console.log(
      'SKIP Authenticated WebSocket: set TEST_ADMIN_ACCESS_TOKEN to a Supabase admin access token',
    );
  }

  if (process.env.RYANAI_LIVE_PROVIDER_TESTS === 'true') {
    if (!adminToken) {
      await test('Live three-brain provider connectivity', async () => {
        throw new Error('TEST_ADMIN_ACCESS_TOKEN is required when RYANAI_LIVE_PROVIDER_TESTS=true');
      });
    } else {
      await test('Live three-brain provider connectivity', async () => {
        const providerTimeoutMs = Number(process.env.PROVIDER_PROBE_TIMEOUT_MS || 90_000);
        const response = await fetch(`${apiUrl}/api/agent/ops/brains/probe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
          signal: AbortSignal.timeout(providerTimeoutMs),
        });
        if (!response.ok) throw new Error(`Provider probe returned HTTP ${response.status}`);
        const body = await response.json();
        const brains = Array.isArray(body?.brains) ? body.brains : [];
        const expected = ['primary', 'secondary', 'logic'];
        const statuses = new Map<string, string>();
        for (const brain of brains) {
          if (brain && typeof brain.brain === 'string' && typeof brain.status === 'string') {
            statuses.set(brain.brain, brain.status);
          }
        }
        const unhealthy = expected.filter((brain) => statuses.get(brain) !== 'HEALTHY');
        if (unhealthy.length) {
          const summary = expected.map((brain) => `${brain}:${statuses.get(brain) || 'MISSING'}`).join(', ');
          throw new Error(`Expected all three providers HEALTHY; received ${summary}`);
        }
        console.log('Live provider connectivity: 3/3 brains HEALTHY');
      });
    }
  } else {
    skipped++;
    console.log('SKIP Live three-brain provider connectivity: set RYANAI_LIVE_PROVIDER_TESTS=true with an admin token and configured provider credentials');
  }

  const failed = results.filter((result) => result.error);
  console.log(
    `\nEnd-to-end checks: ${results.length - failed.length}/${results.length} passed; ${skipped} skipped`,
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
