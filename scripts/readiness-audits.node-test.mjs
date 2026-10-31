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
  assert.equal(report.summary.brainRolesAudited, 3);
  assert.equal(report.summary.configuredBrainRoles, 0);
  assert.equal(report.summary.credentialConfiguredBrains, 0);
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

test('brain credentials are attributed only to providers actually used by each brain', () => {
  const report = auditAgentReadiness({
    env: {
      RYANAI_NVIDIA_KEY_CONFIGURED: 'true',
      RYANAI_QWEN_KEY_CONFIGURED: 'false',
      RYANAI_LOGIC_KEY_CONFIGURED: 'false',
      RYANAI_OPENAI_KEY_CONFIGURED: 'false',
    },
    sourceRoot: process.cwd(),
  });
  const primary = report.brains.find((brain) => brain.id === 'primary');
  const secondary = report.brains.find((brain) => brain.id === 'secondary');
  const logic = report.brains.find((brain) => brain.id === 'logic');
  assert.equal(primary.credentialPresent, true);
  assert.equal(secondary.credentialPresent, false);
  assert.equal(logic.credentialPresent, false);
  assert.equal(report.summary.credentialConfiguredBrains, 1);
  assert.equal(report.summary.configuredBrainRoles, 1);
  assert.equal(report.summary.brainRolesAudited, 3);
});

test('explicit Logic cloud endpoints never inherit the shared LM Studio credential', () => {
  const logicEndpoint = auditAgentReadiness({
    env: {
      LOGIC_API_ENDPOINT: 'https://api.openai.com/v1',
      LM_STUDIO_URL: 'http://localhost:1234/v1',
      LM_STUDIO_API_KEY: 'local-test-key',
      RYANAI_LOGIC_USES_LM_STUDIO: 'true',
    },
    sourceRoot: process.cwd(),
  });
  assert.deepEqual(logicEndpoint.brains.map((brain) => brain.credentialPresent), [true, true, false]);

  const openAiBaseUrl = auditAgentReadiness({
    env: {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      LM_STUDIO_URL: 'http://localhost:1234/v1',
      LM_STUDIO_API_KEY: 'local-test-key',
    },
    sourceRoot: process.cwd(),
  });
  assert.deepEqual(openAiBaseUrl.brains.map((brain) => brain.credentialPresent), [true, true, false]);
});

test('Qwen and OpenAI credentials do not falsely configure the other brain roles', () => {
  const qwen = auditAgentReadiness({ env: { QWEN_API_KEY: 'qwen-test-key' }, sourceRoot: process.cwd() });
  assert.deepEqual(qwen.brains.map((brain) => brain.credentialPresent), [false, true, false]);
  const openai = auditAgentReadiness({ env: { OPENAI_API_KEY: 'openai-test-key' }, sourceRoot: process.cwd() });
  assert.deepEqual(openai.brains.map((brain) => brain.credentialPresent), [false, false, true]);
});

test('local LM Studio credentials are shared only by brains routed to that local endpoint', () => {
  const local = auditAgentReadiness({
    env: { LM_STUDIO_URL: 'http://localhost:1234/v1', LM_STUDIO_API_KEY: 'local-test-key' },
    sourceRoot: process.cwd(),
  });
  assert.deepEqual(local.brains.map((brain) => brain.credentialPresent), [true, true, true]);

  const ollama = auditAgentReadiness({
    env: { OLLAMA_URL: 'http://localhost:11434/v1', LM_STUDIO_API_KEY: 'local-test-key' },
    sourceRoot: process.cwd(),
  });
  assert.deepEqual(ollama.brains.map((brain) => brain.credentialPresent), [true, false, false]);

  const explicitCloud = auditAgentReadiness({
    env: {
      NVIDIA_API_ENDPOINT: 'https://integrate.api.nvidia.com/v1',
      LM_STUDIO_URL: 'http://localhost:1234/v1',
      LM_STUDIO_API_KEY: 'local-test-key',
    },
    sourceRoot: process.cwd(),
  });
  assert.deepEqual(explicitCloud.brains.map((brain) => brain.credentialPresent), [false, true, true]);

  const explicitCloudByRole = auditAgentReadiness({
    env: {
      NVIDIA_API_ENDPOINT: 'https://integrate.api.nvidia.com/v1',
      LM_STUDIO_URL: 'http://localhost:1234/v1',
      LM_STUDIO_API_KEY: 'local-test-key',
    },
    sourceRoot: process.cwd(),
  });
  assert.equal(explicitCloudByRole.brains[0].credentialPresent, false);
});
