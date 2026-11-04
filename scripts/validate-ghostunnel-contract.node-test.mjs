import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'yaml';
import { validateGhostunnelContract } from './validate-ghostunnel-contract.mjs';

const contract = yaml.parse(readFileSync(new URL('../infra/ghostunnel/ghostunnel-contract.yaml', import.meta.url), 'utf8'));

test('accepts the checked-in Ghostunnel security and rollout contract', () => {
  assert.deepEqual(validateGhostunnelContract(contract), []);
});

test('rejects enabling the proxy by default or activating it in production', () => {
  const unsafe = structuredClone(contract);
  unsafe.rollout.enabled_by_default = true;
  unsafe.rollout.production_activation_allowed = true;
  const errors = validateGhostunnelContract(unsafe);
  assert.ok(errors.some((error) => error.includes('enabled_by_default')));
  assert.ok(errors.some((error) => error.includes('production_activation_allowed')));
});

test('rejects authentication bypasses and weak identity rules', () => {
  const unsafe = structuredClone(contract);
  unsafe.identity.allow_all_forbidden = false;
  unsafe.identity.common_name_only_identity_forbidden = false;
  unsafe.network.unsafe_listen_override_forbidden = false;
  const errors = validateGhostunnelContract(unsafe);
  assert.ok(errors.some((error) => error.includes('allow_all_forbidden')));
  assert.ok(errors.some((error) => error.includes('common_name_only_identity_forbidden')));
  assert.ok(errors.some((error) => error.includes('unsafe_listen_override_forbidden')));
});

test('keeps Gen-X authorization independent of certificate identity', () => {
  const unsafe = structuredClone(contract);
  unsafe.authorization.certificate_identity_is_not_action_authorization = false;
  unsafe.authorization.fail_closed_on_missing_or_invalid_identity = false;
  const errors = validateGhostunnelContract(unsafe);
  assert.ok(errors.some((error) => error.includes('certificate_identity_is_not_action_authorization')));
  assert.ok(errors.some((error) => error.includes('fail_closed_on_missing_or_invalid_identity')));
});

test('requires negative certificate tests, telemetry and rollback evidence', () => {
  const unsafe = structuredClone(contract);
  unsafe.acceptance.expired_certificate_rejected = false;
  unsafe.operations.certificate_expiry_monitoring_required = false;
  unsafe.acceptance.rollback_test_required = false;
  const errors = validateGhostunnelContract(unsafe);
  assert.ok(errors.some((error) => error.includes('expired_certificate_rejected')));
  assert.ok(errors.some((error) => error.includes('certificate_expiry_monitoring_required')));
  assert.ok(errors.some((error) => error.includes('rollback_test_required')));
});

test('rejects mutable image tags and unpinned release versions', () => {
  const unsafe = structuredClone(contract);
  unsafe.release.version = 'latest';
  unsafe.release.image = 'ghostunnel/ghostunnel:latest';
  const errors = validateGhostunnelContract(unsafe);
  assert.ok(errors.some((error) => error.includes('pinned to v1.11.5')));
  assert.ok(errors.some((error) => error.includes('pinned distroless release')));
});
