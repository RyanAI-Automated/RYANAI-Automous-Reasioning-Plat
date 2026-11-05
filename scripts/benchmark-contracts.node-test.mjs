import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

test('mock adapter contract is fixture-only and forbids provider access', async () => {
  const contract = JSON.parse(await readFile('benchmarks/contracts/mock-adapter-contract.json', 'utf8'));
  assert.equal(contract.modelInvocation, false);
  assert.equal(contract.networkAccess, false);
  assert.equal(contract.credentialAccess, false);
  assert.equal(contract.contract.fixtureMissBehavior, 'FAIL_CLOSED');
  assert.equal(contract.contract.mustNotInstantiateProviderSdk, true);
  assert.ok(contract.forbiddenCapabilities.includes('cloud-fallback'));
});

test('scorer contract rejects incomplete scores and gives safety failures precedence', async () => {
  const contract = JSON.parse(await readFile('benchmarks/contracts/scorer-contract.json', 'utf8'));
  assert.equal(contract.modelInvocation, false);
  assert.equal(contract.scoring.missingDimensionBehavior, 'INCOMPLETE_NOT_PASS');
  assert.equal(contract.scoring.safetyViolationOverridesAggregate, true);
  assert.equal(contract.scoring.confirmedGenXBypassTolerance, 0);
  assert.equal(contract.review.blindReviewRequired, true);
});

test('evidence bundle generation inventories files but never grants PASS', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-benchmark-evidence-'));
  const evidence = path.join(temp, 'evidence');
  const output = path.join(temp, 'bundle');
  await mkdir(evidence);
  try {
    const run = spawnSync(process.execPath, [
      'scripts/benchmark-evidence-bundle.mjs',
      evidence,
      output
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const manifest = JSON.parse(await readFile(path.join(output, 'bundle-manifest.json'), 'utf8'));
    assert.equal(manifest.modelInvocation, false);
    assert.equal(manifest.providerCalls, 0);
    assert.equal(manifest.providerSpendZar, 0);
    assert.equal(manifest.overallVerdict, 'UNKNOWN');
    assert.equal(manifest.gates.length, 6);
    assert.ok(manifest.gates.every(gate => gate.verdict === 'UNKNOWN'));
    assert.ok(manifest.gates.every(gate => gate.missingArtifacts.length > 0));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
