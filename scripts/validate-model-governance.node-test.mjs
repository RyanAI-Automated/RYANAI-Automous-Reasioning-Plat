import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'yaml';
import { validateModelGovernance } from './validate-model-governance.mjs';

const policy = yaml.parse(readFileSync(new URL('../governance/model-governance.yaml', import.meta.url), 'utf8'));

test('accepts the checked-in RIIP governance contract', () => {
  assert.deepEqual(validateModelGovernance(policy), []);
});

test('rejects model authority and non-fail-closed authorization', () => {
  const unsafe = structuredClone(policy);
  unsafe.authority.models_may_authorize_actions = true;
  unsafe.authority.fail_closed_on_policy_or_identity_failure = false;
  const errors = validateModelGovernance(unsafe);
  assert.ok(errors.some((error) => error.includes('models_may_authorize_actions')));
  assert.ok(errors.some((error) => error.includes('fail-closed')));
});

test('rejects unsafe activation, implicit fallback, and missing rollback', () => {
  const unsafe = structuredClone(policy);
  unsafe.operations.automatic_production_activation = true;
  unsafe.operations.provider_fallback_must_be_explicit = false;
  unsafe.operations.rollback_test_required = false;
  const errors = validateModelGovernance(unsafe);
  assert.ok(errors.some((error) => error.includes('automatic_production_activation')));
  assert.ok(errors.some((error) => error.includes('provider_fallback_must_be_explicit')));
  assert.ok(errors.some((error) => error.includes('rollback_test_required')));
});

test('requires privacy-safe logging, provenance, and known-good revisions', () => {
  const unsafe = structuredClone(policy);
  unsafe.operations.redact_secrets_and_private_payloads_from_logs = false;
  unsafe.operations.record_model_provenance = false;
  unsafe.operations.preserve_known_good_revision = false;
  const errors = validateModelGovernance(unsafe);
  assert.ok(errors.some((error) => error.includes('redact_secrets_and_private_payloads_from_logs')));
  assert.ok(errors.some((error) => error.includes('record_model_provenance')));
  assert.ok(errors.some((error) => error.includes('preserve_known_good_revision')));
});

test('requires complete measurable evaluation gates', () => {
  const unsafe = structuredClone(policy);
  unsafe.evaluation.report_latency_p50_p95 = false;
  unsafe.evaluation.report_cost_per_successful_task = false;
  unsafe.evaluation.quality_non_inferiority_on_critical_slices = false;
  const errors = validateModelGovernance(unsafe);
  assert.ok(errors.some((error) => error.includes('report_latency_p50_p95')));
  assert.ok(errors.some((error) => error.includes('report_cost_per_successful_task')));
  assert.ok(errors.some((error) => error.includes('quality_non_inferiority_on_critical_slices')));
});

test('requires exact revision and evidence before a model can be marked verified', () => {
  const unsafe = structuredClone(policy);
  unsafe.model_registry[0].status = 'verified';
  const errors = validateModelGovernance(unsafe);
  assert.ok(errors.some((error) => error.includes('exact revision')));
  assert.ok(errors.some((error) => error.includes('reproducible evidence')));
  const safe = structuredClone(policy);
  safe.model_registry[0].status = 'verified';
  safe.model_registry[0].revision = 'sha256:example-pinned-revision';
  safe.model_registry[0].evidence_reference = 'reports/model-eval-001.json';
  assert.deepEqual(validateModelGovernance(safe), []);
});

test('rejects duplicate model ids, missing task scopes, and authority grants', () => {
  const unsafe = structuredClone(policy);
  unsafe.model_registry[1].id = unsafe.model_registry[0].id;
  unsafe.model_registry[2].task_families = [];
  unsafe.model_registry[3].authority = 'admin';
  const errors = validateModelGovernance(unsafe);
  assert.ok(errors.some((error) => error.includes('duplicate model id')));
  assert.ok(errors.some((error) => error.includes('task_families')));
  assert.ok(errors.some((error) => error.includes('authority')));
});

test('requires ZAR economics and South African language evaluation slices', () => {
  const unsafe = structuredClone(policy);
  unsafe.engineering_acceptance.cost_currency = 'USD';
  unsafe.evaluation.language_slices = ['en-US'];
  const errors = validateModelGovernance(unsafe);
  assert.ok(errors.some((error) => error.includes('ZAR')));
  assert.ok(errors.some((error) => error.includes('en-ZA')));
  assert.ok(errors.some((error) => error.includes('ve-ZA')));
});
