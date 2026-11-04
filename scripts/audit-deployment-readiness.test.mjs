import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./audit-deployment-readiness.mjs', import.meta.url);

function run(env) {
  return spawnSync(process.execPath, [script.pathname, '--strict'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', ...env },
    timeout: 10000,
  });
}

test('Railway stays disabled unless its explicit deployment gate is enabled', () => {
  const result = run({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /DISABLED \| Railway \| gate: RAILWAY_DEPLOY_ENABLED/);
});

test('enabled Railway deployment is blocked until project, environment, services and token exist', () => {
  const result = run({ RAILWAY_DEPLOY_ENABLED: 'true' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BLOCKED \| Railway/);
  for (const key of ['RAILWAY_TOKEN', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID',
    'RAILWAY_API_SERVICE_ID', 'RAILWAY_MCP_SERVICE_ID', 'RAILWAY_WORKER_SERVICE_ID']) {
    assert.ok(result.stdout.includes(key), 'missing Railway prerequisite should name ' + key);
  }
});

test('fully configured Railway target passes readiness without printing credential values', () => {
  const result = run({
    RAILWAY_DEPLOY_ENABLED: 'true',
    RAILWAY_TOKEN: 'true',
    RAILWAY_PROJECT_ID: 'project-id',
    RAILWAY_ENVIRONMENT_ID: 'environment-id',
    RAILWAY_API_SERVICE_ID: 'api-service-id',
    RAILWAY_MCP_SERVICE_ID: 'mcp-service-id',
    RAILWAY_WORKER_SERVICE_ID: 'worker-service-id',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /READY \| Railway/);
  assert.equal(result.stdout.includes('project-id'), false);
});
