import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'yaml';
import { validateModelGovernance } from './validate-model-governance.mjs';

const policy = yaml.parse(readFileSync(new URL('../governance/model-governance.yaml', import.meta.url), 'utf8'));

test('accepts the checked-in RIIP governance contract', () => {
  assert.deepEqual(validateModelGovernance(policy), []);
});

test('rejects any attempt to give a model authorization authority', () => {
  const unsafe = structuredClone(policy);
  unsafe.authority.models_may_authorize_actions = true;
  assert.ok(validateModelGovernance(unsafe).some((error) => error.includes('models_may_authorize_actions')));
});

test('rejects automatic production activation and missing rollback evidence', () => {
  const unsafe = structuredClone(policy);
  unsafe.operations.automatic_production_activation = true;
  unsafe.operations.rollback_test_required = false;
  const errors = validateModelGovernance(unsafe);
  assert.ok(errors.some((error) => error.includes('automatic')));
  assert.ok(errors.some((error) => error.includes('rollback')));
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
