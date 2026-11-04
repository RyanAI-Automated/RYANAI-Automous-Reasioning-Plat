import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentTargets, verifyPlatformDeployments } from './verify-platform-deployments.mjs';

const completeEnv = {
  RENDER_FRONTEND_HEALTH_URL: 'https://ryanai-web.example/health',
  VERCEL_BACKEND_HEALTH_URL: 'https://ryanai-backend.example/api/health',
  RAILWAY_API_HEALTH_URL: 'https://ryanai-api.example/health',
  RAILWAY_MCP_HEALTH_URL: 'https://ryanai-mcp.example/health',
};

test('covers Render frontend, Vercel backend, and Railway API plus MCP', () => {
  assert.deepEqual(deploymentTargets.map((item) => item.platform + ':' + item.service), [
    'Render:frontend', 'Vercel:backend', 'Railway:API', 'Railway:MCP',
  ]);
});

test('reports unconfigured endpoints without making network requests', async () => {
  let calls = 0;
  const results = await verifyPlatformDeployments({}, async () => { calls += 1; });
  assert.equal(calls, 0);
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.status === 'MISSING'));
});

test('marks all endpoints healthy on successful HTTP responses', async () => {
  const results = await verifyPlatformDeployments(completeEnv, async () => ({ status: 200 }));
  assert.ok(results.every((result) => result.status === 'HEALTHY'));
  assert.ok(results.every((result) => result.httpStatus === 200));
});

test('marks non-success HTTP responses unhealthy and does not follow SSO redirects', async () => {
  let calls = 0;
  const results = await verifyPlatformDeployments(completeEnv, async (_url, options) => {
    calls += 1;
    assert.equal(options.redirect, 'manual');
    return { status: 302 };
  });
  assert.equal(calls, 4);
  assert.ok(results.every((result) => result.status === 'UNHEALTHY'));
});

test('rejects insecure, credential-bearing, and localhost health URLs', async () => {
  const env = {
    ...completeEnv,
    RENDER_FRONTEND_HEALTH_URL: 'http://unsafe.example/health',
    VERCEL_BACKEND_HEALTH_URL: 'https://user:pass@example.com/api/health',
    RAILWAY_API_HEALTH_URL: 'https://localhost:3000/health',
  };
  let calls = 0;
  const results = await verifyPlatformDeployments(env, async () => { calls += 1; return { status: 200 }; });
  assert.equal(calls, 1);
  assert.equal(results[0].status, 'INVALID');
  assert.equal(results[1].status, 'INVALID');
  assert.equal(results[2].status, 'INVALID');
  assert.equal(results[3].status, 'HEALTHY');
});

test('does not expose full URL query strings in results', async () => {
  const env = { ...completeEnv, RAILWAY_MCP_HEALTH_URL: 'https://mcp.example/health?token=do-not-print' };
  const results = await verifyPlatformDeployments(env, async () => ({ status: 200 }));
  assert.equal(results[3].host, 'mcp.example');
  assert.equal(JSON.stringify(results).includes('do-not-print'), false);
});

test('classifies network failures without leaking raw error text', async () => {
  const results = await verifyPlatformDeployments(completeEnv, async () => {
    throw new Error('request failed with token=do-not-print');
  });
  assert.ok(results.every((result) => result.status === 'UNHEALTHY'));
  assert.equal(JSON.stringify(results).includes('do-not-print'), false);
});
