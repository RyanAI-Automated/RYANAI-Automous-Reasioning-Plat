import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  configurationReport,
  loadConfiguration,
  parseArgs,
  validateStartOptions,
  verifyRuntime,
} from './activate-apis.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('parseArgs defaults to preflight and rejects unsupported commands', () => {
  assert.equal(parseArgs([]).command, 'preflight');
  assert.deepEqual(
    [...parseArgs(['start', '--allow-committed-migrations', '--confirm-database-backup']).flags],
    ['--allow-committed-migrations', '--confirm-database-backup'],
  );
  assert.throws(() => parseArgs(['restart']), /Command must be preflight, start, verify, or report/);
});

test('loadConfiguration lets process environment values override the local env file', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ryanai-api-activation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const envFile = path.join(directory, '.env');
  writeFileSync(
    envFile,
    'DB_PASSWORD=file-db-value\nREDIS_PASSWORD=file-redis-value\n',
    'utf8',
  );

  const configuration = loadConfiguration(
    { DB_PASSWORD: 'process-db-value', NODE_ENV: 'test' },
    envFile,
  );

  assert.deepEqual(configuration, {
    DB_PASSWORD: 'process-db-value',
    REDIS_PASSWORD: 'file-redis-value',
    NODE_ENV: 'test',
  });
});

test('configurationReport distinguishes configured credentials from verified providers', () => {
  const configuration = configurationReport({
    DB_PASSWORD: 'fixture-db-secret',
    REDIS_PASSWORD: 'fixture-redis-secret',
    JWT_SECRET: 'fixture-jwt-secret',
    MCP_AUTH_TOKEN: 'm'.repeat(32),
    NVIDIA_API_KEY: 'fixture-nvidia-key',
    JARVIS_SYNC_ENABLED: 'true',
    MCPJUNGLE_DB_PASSWORD: 'fixture-mcpjungle-secret',
    CLOUDFLARE_TUNNEL_TOKEN: 'fixture-cloudflare-token',
  });

  assert.equal(configuration.core.status, 'configured');
  assert.equal(configuration.providers.NVIDIA.status, 'configured_unverified');
  assert.equal(configuration.providers.QWEN.status, 'missing_credentials');
  assert.equal(configuration.integrations.jarvis.status, 'blocked_missing_credentials');
  assert.equal(configuration.integrations.mcpjungle.status, 'configured_unverified');
  assert.equal(configuration.integrations.cloudflareTunnel.status, 'configured_unverified_not_started');
  assert.equal(configuration.communications.whatsapp.status, 'missing_credentials');
  assert.doesNotMatch(
    JSON.stringify(configuration),
    /fixture-(?:db|redis|jwt|nvidia|mcpjungle|cloudflare)/,
  );
});

test('configurationReport blocks placeholder values and short MCP authentication tokens', () => {
  const configuration = configurationReport({
    DB_PASSWORD: 'changeme',
    REDIS_PASSWORD: 'replace-with-a-real-password',
    JWT_SECRET: 'your_jwt_secret',
    MCP_AUTH_TOKEN: 'short',
  });

  assert.equal(configuration.core.status, 'blocked');
  assert.deepEqual(configuration.core.checks, {
    DB_PASSWORD: false,
    REDIS_PASSWORD: false,
    JWT_SECRET: false,
    MCP_AUTH_TOKEN: false,
  });
});

test('validateStartOptions requires both explicit migration and database-backup acknowledgements', () => {
  const configured = { core: { status: 'configured' } };
  const acknowledgements = new Set([
    '--allow-committed-migrations',
    '--confirm-database-backup',
  ]);

  assert.throws(() => validateStartOptions(new Set(), configured), /Start is blocked/);
  assert.throws(
    () => validateStartOptions(acknowledgements, { core: { status: 'blocked' } }),
    /Core configuration is incomplete/,
  );
  assert.doesNotThrow(() => validateStartOptions(acknowledgements, configured));
});

test('verifyRuntime fails closed when API health does not confirm PostgreSQL and Redis', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url === 'http://api.test/health') {
      return jsonResponse({
        status: 'online',
        services: { database: false, redis: true },
      });
    }
    return jsonResponse({ status: 'online' });
  };

  try {
    const runtime = await verifyRuntime(
      {
        RYANAI_API_HEALTH_URL: 'http://api.test/health',
        RYANAI_MCP_HEALTH_URL: 'http://mcp.test/health',
        RYANAI_WEB_HEALTH_URL: 'http://web.test/health',
        RYANAI_COMMS_STATUS_URL: 'http://api.test/api/comms/status',
      },
      { timeoutMs: 50 },
    );

    assert.equal(runtime.runtime.api.status, 'unhealthy');
    assert.match(runtime.runtime.api.diagnostic, /does not confirm database and Redis readiness/);
    assert.equal(runtime.communications.status, 'unavailable');
    assert.ok(!requestedUrls.includes('http://api.test/api/comms/status'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verifyRuntime reports communications as a configuration snapshot, not delivery verification', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url === 'http://api.test/health') {
      return jsonResponse({
        status: 'online',
        services: { database: true, redis: true },
      });
    }
    if (url === 'http://api.test/api/comms/status') {
      return jsonResponse({
        status: 'configuration_snapshot',
        channels: { whatsapp: { status: 'configured_unverified' } },
        note: 'Configuration only; no provider delivery was tested.',
      });
    }
    return jsonResponse({ status: 'online' });
  };

  try {
    const runtime = await verifyRuntime(
      {
        RYANAI_API_HEALTH_URL: 'http://api.test/health',
        RYANAI_MCP_HEALTH_URL: 'http://mcp.test/health',
        RYANAI_WEB_HEALTH_URL: 'http://web.test/health',
        RYANAI_COMMS_STATUS_URL: 'http://api.test/api/comms/status',
      },
      { timeoutMs: 250 },
    );

    assert.equal(runtime.runtime.api.status, 'healthy');
    assert.equal(runtime.runtime.api.database, true);
    assert.equal(runtime.runtime.api.redis, true);
    assert.equal(runtime.runtime.mcp.status, 'healthy');
    assert.equal(runtime.runtime.web.status, 'healthy');
    assert.equal(runtime.communications.status, 'configuration_snapshot');
    assert.equal(runtime.communications.channels.whatsapp.status, 'configured_unverified');
    assert.ok(requestedUrls.includes('http://api.test/api/comms/status'));
    assert.match(runtime.note, /No outbound message/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
