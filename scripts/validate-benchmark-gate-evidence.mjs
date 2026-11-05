#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GATE_IDS = Object.freeze([
  'G1_ISOLATION',
  'G2_DATASET',
  'G3_PROVENANCE',
  'G4_SCORING',
  'G5_PERFORMANCE_ECONOMICS',
  'G6_GENX_AUTHORIZATION',
]);

const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isIsoDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

export function validateBenchmarkGateEvidence(bundle) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };

  require(bundle?.schema_version === 1, 'schema_version must be 1');
  require(typeof bundle?.run_id === 'string' && bundle.run_id.length > 0, 'run_id is required');
  require(['A_OFFLINE_OLLAMA', 'B_REMOTE_PROVIDER'].includes(bundle?.profile), 'profile must be A_OFFLINE_OLLAMA or B_REMOTE_PROVIDER');
  require(typeof bundle?.harness_commit === 'string' && /^[a-f0-9]{40}$/.test(bundle.harness_commit), 'harness_commit must be a full 40-character commit SHA');
  require(isIsoDate(bundle?.created_at), 'created_at must be an ISO date-time');
  require(bundle?.model_invocation_authorized === false, 'model_invocation_authorized must remain false for this implementation phase');
  require(bundle?.model_invocations === 0, 'model_invocations must be zero');

  const gates = Array.isArray(bundle?.gates) ? bundle.gates : [];
  require(gates.length === 6, 'exactly six independent gate records are required');
  const byId = new Map();
  for (const gate of gates) {
    if (!GATE_IDS.includes(gate?.gate_id)) {
      errors.push(`unknown gate_id: ${String(gate?.gate_id)}`);
      continue;
    }
    if (byId.has(gate.gate_id)) errors.push(`duplicate gate record: ${gate.gate_id}`);
    byId.set(gate.gate_id, gate);
  }

  for (const id of GATE_IDS) {
    const gate = byId.get(id);
    if (!gate) {
      errors.push(`missing gate record: ${id}`);
      continue;
    }
    require(['PASS', 'FAIL', 'BLOCKED'].includes(gate.verdict), `${id}: verdict must be PASS, FAIL, or BLOCKED`);
    require(typeof gate.owner === 'string' && gate.owner.trim().length > 0, `${id}: named owner is required`);
    require(typeof gate.procedure_version === 'string' && gate.procedure_version.trim().length > 0, `${id}: procedure_version is required`);
    require(Array.isArray(gate.evidence), `${id}: evidence must be an array`);
    if (gate.verdict === 'PASS') {
      require(gate.evidence?.length > 0, `${id}: PASS requires at least one evidence artifact`);
      require(gate.independent_attestation === true, `${id}: PASS requires independent attestation`);
      require(isIsoDate(gate.attested_at), `${id}: PASS requires an attested_at timestamp`);
    }
    for (const artifact of Array.isArray(gate.evidence) ? gate.evidence : []) {
      require(typeof artifact?.path === 'string' && artifact.path.length > 0, `${id}: evidence artifact path is required`);
      require(isSha256(artifact?.sha256), `${id}: evidence artifact SHA-256 must be 64 lowercase hex characters`);
    }
  }

  const isolation = byId.get('G1_ISOLATION');
  if (bundle.profile === 'A_OFFLINE_OLLAMA') {
    require(bundle?.remote_credentials_mounted === false, 'Profile A must prove remote_credentials_mounted=false');
    require(bundle?.cloud_fallback_enabled === false, 'Profile A must prove cloud_fallback_enabled=false');
    require(bundle?.os_egress_enforcement_evidence === true, 'Profile A requires OS/container egress enforcement evidence');
    require(isolation?.verdict !== 'PASS' || isolation?.ollama_loopback_only === true, 'Profile A G1 PASS requires Ollama loopback-only proof');
  }
  if (bundle.profile === 'B_REMOTE_PROVIDER') {
    require(bundle?.remote_credentials_mounted === true, 'Profile B must explicitly record scoped remote credentials as mounted');
    require(typeof bundle?.provider_secret_name === 'string' && bundle.provider_secret_name.length > 0, 'Profile B must record secret name, never its value');
    require(typeof bundle?.endpoint_host === 'string' && bundle.endpoint_host.length > 0, 'Profile B requires an allowlisted endpoint host');
    require(typeof bundle?.spend_ceiling_zar === 'number' && Number.isFinite(bundle.spend_ceiling_zar) && bundle.spend_ceiling_zar > 0, 'Profile B requires a positive numeric ZAR spend ceiling before any call');
    require(bundle?.explicit_evaluation_approval === true, 'Profile B requires explicit evaluation-scope approval');
    require(bundle?.cloud_fallback_enabled === false, 'Profile B must prove cross-provider fallback is disabled');
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/validate-benchmark-gate-evidence.mjs <evidence-bundle.json>');
    process.exit(2);
  }
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(resolve(input), 'utf8'));
  } catch (error) {
    console.error(`FAIL unable to read evidence bundle: ${error.message}`);
    process.exit(2);
  }
  const errors = validateBenchmarkGateEvidence(bundle);
  if (errors.length) {
    console.error(errors.map((error) => `FAIL ${error}`).join('\\n'));
    process.exit(1);
  }
  const verdicts = bundle.gates.map((gate) => `${gate.gate_id}=${gate.verdict}`).join(', ');
  console.log(`PASS evidence structure valid; profile=${bundle.profile}; ${verdicts}`);
}
