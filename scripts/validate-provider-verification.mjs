#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'yaml';

const workflowPath = '.github/workflows/provider-verification.yml';
const probePath = 'scripts/provider-live-probe.mjs';
const workflowText = readFileSync(workflowPath, 'utf8');
const workflow = yaml.parse(workflowText);
const probe = readFileSync(probePath, 'utf8');
const errors = [];

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

requireCondition(workflow.name === 'Isolated Provider Verification', 'workflow name must remain explicit');
requireCondition(Boolean(workflow.on?.workflow_dispatch), 'provider verification must remain manually dispatched');
requireCondition(workflow.on.workflow_dispatch.inputs?.provider?.required === true, 'provider selection must be required');
requireCondition(
  JSON.stringify(workflow.on.workflow_dispatch.inputs.provider.options) === JSON.stringify(['primary', 'secondary', 'logic', 'all']),
  'provider selector must support each brain and the all option',
);
requireCondition(workflow.permissions?.contents === 'read', 'workflow token must remain read-only');
requireCondition(workflow.jobs?.verify?.environment === 'ryanai-provider-verification', 'provider secrets must remain scoped to the verification environment');
requireCondition(workflow.jobs?.verify?.strategy?.['fail-fast'] === false, 'one provider failure must not cancel the other provider jobs');
requireCondition(
  workflow.jobs?.verify?.concurrency?.group === 'ryanai-provider-verification-${{ matrix.provider }}' &&
  workflow.jobs?.verify?.concurrency?.['cancel-in-progress'] === false,
  'each brain must be serialized across all/single dispatches without cancelling in-flight evidence',
);
requireCondition(!Object.hasOwn(workflow, 'concurrency'), 'workflow-level input concurrency must not split all-brain and single-brain locks');
requireCondition(
  workflow.jobs?.verify?.services?.postgres?.image === 'postgres:16-alpine',
  'each provider job must use its own disposable PostgreSQL service',
);
requireCondition(
  String(workflow.jobs?.verify?.strategy?.matrix?.provider ?? '').includes('primary') &&
  String(workflow.jobs?.verify?.strategy?.matrix?.provider ?? '').includes('secondary') &&
  String(workflow.jobs?.verify?.strategy?.matrix?.provider ?? '').includes('logic'),
  'all selection must fan out into three independent provider jobs',
);
for (const binding of [
  'secrets.NVIDIA_API_KEY',
  'secrets.QWEN_API_KEY',
  'secrets.LOGIC_API_KEY',
  'secrets.OPENAI_API_KEY',
]) {
  requireCondition(workflowText.includes(binding), `missing expected credential binding: ${binding}`);
}
requireCondition(
  workflow.jobs?.verify?.steps?.some((step) => String(step.run ?? '').includes('scripts/provider-live-probe.mjs')),
  'workflow must execute the authenticated live probe',
);
requireCondition(probe.includes('assertBrainProbeResponse(output)'), 'live probe must validate the exact challenge response');
requireCondition(probe.includes('agentBrainHealth.upsert'), 'live probe must persist provider health');
requireCondition(probe.includes('agentBrainHealth.findUnique'), 'live probe must read provider health back');
requireCondition(probe.includes('persistenceVerified: true'), 'evidence must explicitly record database readback');
requireCondition(!/console\.log\([^\n]*(?:apiKey|PROVIDER_API_KEY|NVIDIA_API_KEY|QWEN_API_KEY|LOGIC_API_KEY)/i.test(probe), 'live probe must not log credentials');

if (errors.length) {
  console.error(errors.map((error) => `FAIL ${error}`).join('\n'));
  process.exit(1);
}
console.log('PASS provider verification workflow: per-brain concurrency, scoped secrets, exact challenge, and persisted readback');
