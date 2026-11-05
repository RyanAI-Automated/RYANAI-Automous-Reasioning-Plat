import test from 'node:test';
import assert from 'node:assert/strict';
import { GATE_IDS, validateBenchmarkGateEvidence } from './validate-benchmark-gate-evidence.mjs';

const validBundle = () => ({
  schema_version: 1,
  run_id: 'synthetic-contract-test',
  profile: 'A_OFFLINE_OLLAMA',
  harness_commit: 'a'.repeat(40),
  created_at: '2026-11-05T00:00:00.000Z',
  model_invocation_authorized: false,
  model_invocations: 0,
  remote_credentials_mounted: false,
  cloud_fallback_enabled: false,
  os_egress_enforcement_evidence: true,
  gates: GATE_IDS.map((gate_id) => ({
    gate_id, verdict: 'BLOCKED', owner: 'unassigned', procedure_version: '0.1.0',
    evidence: [], independent_attestation: false, attested_at: null,
  })),
});

test('accepts six explicit BLOCKED records without treating them as passes', () => {
  assert.deepEqual(validateBenchmarkGateEvidence(validBundle()), []);
});

test('rejects missing, duplicate, and unknown gates', () => {
  const bundle = validBundle();
  bundle.gates.pop();
  bundle.gates.push({ ...bundle.gates[0] });
  bundle.gates.push({ ...bundle.gates[0], gate_id: 'G7_UNKNOWN' });
  const errors = validateBenchmarkGateEvidence(bundle);
  assert.ok(errors.some((error) => error.includes('exactly six')));
  assert.ok(errors.some((error) => error.includes('duplicate')));
  assert.ok(errors.some((error) => error.includes('unknown')));
});

test('rejects PASS without evidence and independent attestation', () => {
  const bundle = validBundle();
  bundle.gates[0].verdict = 'PASS';
  const errors = validateBenchmarkGateEvidence(bundle);
  assert.ok(errors.some((error) => error.includes('PASS requires at least one evidence artifact')));
  assert.ok(errors.some((error) => error.includes('PASS requires independent attestation')));
});

test('rejects Profile A without OS-enforced egress evidence or with remote credentials', () => {
  const bundle = validBundle();
  bundle.os_egress_enforcement_evidence = false;
  bundle.remote_credentials_mounted = true;
  const errors = validateBenchmarkGateEvidence(bundle);
  assert.ok(errors.some((error) => error.includes('OS/container egress')));
  assert.ok(errors.some((error) => error.includes('remote_credentials_mounted=false')));
});

test('rejects Profile B until spend ceiling and explicit approval exist', () => {
  const bundle = validBundle();
  bundle.profile = 'B_REMOTE_PROVIDER';
  bundle.remote_credentials_mounted = true;
  bundle.provider_secret_name = 'NVIDIA_API_KEY';
  bundle.endpoint_host = 'integrate.api.nvidia.com';
  bundle.cloud_fallback_enabled = false;
  bundle.spend_ceiling_zar = 0;
  bundle.explicit_evaluation_approval = false;
  const errors = validateBenchmarkGateEvidence(bundle);
  assert.ok(errors.some((error) => error.includes('positive numeric ZAR spend ceiling')));
  assert.ok(errors.some((error) => error.includes('explicit evaluation-scope approval')));
});

test('rejects any attempt to record model invocation during this phase', () => {
  const bundle = validBundle();
  bundle.model_invocations = 1;
  assert.ok(validateBenchmarkGateEvidence(bundle).some((error) => error.includes('model_invocations must be zero')));
});
