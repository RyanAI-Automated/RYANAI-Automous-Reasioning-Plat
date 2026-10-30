import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDeploymentTargets } from './audit-deployment-readiness.mjs';
import { auditAgentReadiness } from './audit-agent-readiness.mjs';

test('deployment targets remain disabled unless explicitly enabled', () => {
  const results = auditDeploymentTargets({});
  assert.equal(results.length, 5);
  assert.ok(results.every((target) => target.status === 'DISABLED'));
  assert.ok(results.every((target) => target.deploymentAttempted === false));
});

test('enabled deployment with missing configuration is blocked', () => {
  const results = auditDeploymentTargets({ AWS_ECS_DEPLOY_ENABLED: 'true' });
  const aws = results.find((target) => target.name === 'AWS ECS');
  assert.equal(aws.status, 'BLOCKED');
  assert.ok(aws.missing.includes('AWS_ACCESS_KEY_ID'));
  assert.equal(aws.deploymentAttempted, false);
});

test('fully configured optional target reports ready without deploying', () => {
  const env = {
    DATADOG_SYNTHETICS_ENABLED: 'true',
    DD_API_KEY: 'test-only',
    DD_APP_KEY: 'test-only',
  };
  const datadog = auditDeploymentTargets(env).find((target) => target.name === 'Datadog Synthetics');
  assert.equal(datadog.status, 'READY');
  assert.equal(datadog.deploymentAttempted, false);
});

test('agent audit distinguishes code definitions from verified live agents', () => {
  const report = auditAgentReadiness({ env: {}, sourceRoot: process.cwd() });
  assert.equal(report.summary.configuredBrainRoles, 3);
  assert.ok(report.summary.codeDefinedAgents >= 7);
  assert.equal(report.summary.liveAgentsVerified, 0);
  assert.equal(report.summary.runtimeTelemetryAvailable, false);
  assert.ok(report.agents.every((agent) => agent.runtimeState === 'UNKNOWN'));
});

test('brain credentials are reported as presence only, never values', () => {
  const report = auditAgentReadiness({
    env: { NVIDIA_API_KEY: 'do-not-print-this' },
    sourceRoot: process.cwd(),
  });
  const primary = report.brains.find((brain) => brain.id === 'primary');
  assert.equal(primary.status, 'CONFIGURED_NOT_PROBED');
  assert.equal(JSON.stringify(report).includes('do-not-print-this'), false);
});
