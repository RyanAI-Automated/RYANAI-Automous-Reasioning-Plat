import assert from 'node:assert/strict';
import test from 'node:test';
import { auditDeploymentTargets } from './audit-deployment-readiness.mjs';

test('reports Render, Vercel, and Railway independently', () => {
  const results = auditDeploymentTargets({});
  assert.deepEqual(results.slice(0, 3).map(({ name, status }) => [name, status]), [
    ['Vercel', 'DISABLED'],
    ['Render', 'DISABLED'],
    ['Railway', 'DISABLED'],
  ]);
});

test('blocks enabled platforms when required deployment configuration is missing', () => {
  const results = auditDeploymentTargets({
    RENDER_DEPLOY_ENABLED: 'true',
    VERCEL_DEPLOY_ENABLED: 'true',
    RAILWAY_DEPLOY_ENABLED: 'true',
  });
  for (const name of ['Render', 'Vercel', 'Railway']) {
    const result = results.find((item) => item.name === name);
    assert.equal(result.status, 'BLOCKED', name);
    assert.ok(result.missing.length > 0, name);
    assert.equal(result.deploymentAttempted, false, name);
  }
});

test('marks each platform ready only when its own gate and all required values exist', () => {
  const results = auditDeploymentTargets({
    RENDER_DEPLOY_ENABLED: 'true',
    RENDER_DEPLOY_HOOK_URL: 'https://example.invalid/hook',
    VERCEL_DEPLOY_ENABLED: 'true',
    VERCEL_TOKEN: 'fixture-vercel-token',
    VERCEL_ORG_ID: 'fixture-org',
    VERCEL_PROJECT_ID: 'fixture-project',
    VITE_API_BASE_URL: 'https://api.example.invalid',
    RAILWAY_DEPLOY_ENABLED: 'true',
    RAILWAY_TOKEN: 'fixture-railway-token',
    RAILWAY_PROJECT_ID: 'fixture-project',
    RAILWAY_SERVICE_ID: 'fixture-service',
    RAILWAY_ENVIRONMENT_ID: 'fixture-environment',
  });
  for (const name of ['Render', 'Vercel', 'Railway']) {
    assert.equal(results.find((item) => item.name === name).status, 'READY', name);
  }
  assert.ok(results.every((item) => item.deploymentAttempted === false));
});

test('does not expose secret values in readiness results', () => {
  const secret = 'do-not-print-this-fixture-secret';
  const results = auditDeploymentTargets({
    RAILWAY_DEPLOY_ENABLED: 'true',
    RAILWAY_TOKEN: secret,
  });
  assert.ok(!JSON.stringify(results).includes(secret));
  assert.deepEqual(results.find((item) => item.name === 'Railway').missing, [
    'RAILWAY_PROJECT_ID',
    'RAILWAY_SERVICE_ID',
    'RAILWAY_ENVIRONMENT_ID',
  ]);
});
