import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { verifyBenchmarkDataset } from './verify-benchmark-dataset.mjs';
import { verifyBenchmarkProvenance } from './verify-benchmark-provenance.mjs';
import {
  assertModelInputHasNoScoringOracle,
  evaluateScoringRecord
} from './benchmark-scoring-contract.mjs';
import {
  calculateLocalCostZar,
  compareRepeatability,
  summarizeBenchmarkRun
} from './benchmark-economics-contract.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

test('dataset validator verifies development hashes and evaluator-only attestations', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-dataset-'));
  const dataset = path.join(temp, 'dataset');
  const evidence = path.join(temp, 'evidence');
  await mkdir(path.join(dataset, 'development'), { recursive: true });
  await mkdir(evidence);
  try {
    const task = JSON.stringify({
      taskId: 'synthetic-001', family: 'reasoning', difficulty: 'easy',
      locale: 'en-ZA', modelInput: { prompt: 'Synthetic task only.' },
      toolPermissions: []
    }) + '\n';
    await writeFile(path.join(dataset, 'development', 'tasks.jsonl'), task);
    const attestations = {};
    for (const name of ['aclEvidence', 'accessAudit', 'contaminationReview']) {
      const content = 'synthetic ' + name;
      await writeFile(path.join(evidence, name + '.txt'), content);
      attestations[name] = {
        path: name + '.txt', sha256: hash(content)
      };
    }
    const manifest = {
      schemaVersion: '1.0.0', visibility: 'DEVELOPMENT_ONLY',
      version: 'synthetic-1',
      files: [{
        path: 'development/tasks.jsonl',
        sha256: hash(task), taskCount: 1
      }],
      heldout: {
        storageRef: 'external://evaluator-vault/heldout-v1',
        evaluatorOnly: true, modelRunnerAccess: false,
        ...attestations
      }
    };
    await writeFile(path.join(dataset, 'manifest.json'), JSON.stringify(manifest));
    const result = await verifyBenchmarkDataset(
      path.join(dataset, 'manifest.json'), dataset, evidence
    );
    assert.equal(result.taskCount, 1);
    assert.equal(result.gateVerdict, 'BLOCKED');
    assert.equal(result.modelInvocation, false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('dataset validator rejects hash tampering and evaluator labels in model input', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-dataset-invalid-'));
  const dataset = path.join(temp, 'dataset');
  const evidence = path.join(temp, 'evidence');
  await mkdir(path.join(dataset, 'development'), { recursive: true });
  await mkdir(evidence);
  try {
    const task = JSON.stringify({
      taskId: 'synthetic-002', modelInput: {
        prompt: 'safe', expectedAnswer: 'leaked'
      }, toolPermissions: []
    }) + '\n';
    await writeFile(path.join(dataset, 'development', 'tasks.jsonl'), task);
    const names = ['aclEvidence', 'accessAudit', 'contaminationReview'];
    const attestations = {};
    for (const name of names) {
      await writeFile(path.join(evidence, name), name);
      attestations[name] = { path: name, sha256: hash(name) };
    }
    const manifest = {
      schemaVersion: '1.0.0', visibility: 'DEVELOPMENT_ONLY',
      version: 'synthetic-2',
      files: [{
        path: 'development/tasks.jsonl',
        sha256: hash(task), taskCount: 1
      }],
      heldout: {
        storageRef: 'external://vault/heldout',
        evaluatorOnly: true, modelRunnerAccess: false,
        ...attestations
      }
    };
    await writeFile(path.join(dataset, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(
      verifyBenchmarkDataset(path.join(dataset, 'manifest.json'), dataset, evidence),
      /evaluator-only field/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('provenance validator checks lock, prompt, config hashes and immutable identity', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-provenance-'));
  try {
    const files = {
      'package-lock.json': '{"lockfileVersion":3}',
      'prompt.txt': 'Synthetic benchmark prompt.',
      'config.json': '{"temperature":0,"maxOutputTokens":128}'
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(temp, name), content);
    }
    const manifest = {
      schemaVersion: '1.0.0', modelInvocation: false,
      harnessCommit: 'a'.repeat(40),
      dataset: { manifestSha256: 'b'.repeat(64) },
      runtimeLock: {
        path: 'package-lock.json', sha256: hash(files['package-lock.json'])
      },
      candidates: [{
        id: 'fixture-model', provider: 'fixture',
        model: 'fixture-model-v1', immutableRevision: 'sha256:' + 'c'.repeat(64),
        revisionKind: 'digest', runtimeVersion: 'fixture-runtime-1',
        promptTemplate: { path: 'prompt.txt', sha256: hash(files['prompt.txt']) },
        nonSecretConfig: { path: 'config.json', sha256: hash(files['config.json']) }
      }]
    };
    const manifestPath = path.join(temp, 'run-manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = await verifyBenchmarkProvenance(manifestPath, temp);
    assert.equal(result.gateVerdict, 'BLOCKED');
    assert.equal(result.candidates[0].revisionKind, 'digest');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('provenance validator rejects mutable aliases and secret-bearing config', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-provenance-invalid-'));
  try {
    const files = {
      'package-lock.json': 'lock',
      'prompt.txt': 'prompt',
      'config.json': '{"api_key":"do-not-use-real-secrets"}'
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(temp, name), content);
    }
    const manifest = {
      schemaVersion: '1.0.0', modelInvocation: false,
      harnessCommit: 'a'.repeat(40),
      dataset: { manifestSha256: 'b'.repeat(64) },
      runtimeLock: { path: 'package-lock.json', sha256: hash('lock') },
      candidates: [{
        id: 'fixture', provider: 'fixture', model: 'latest',
        immutableRevision: 'latest', revisionKind: 'snapshot',
        runtimeVersion: 'fixture-1',
        promptTemplate: { path: 'prompt.txt', sha256: hash('prompt') },
        nonSecretConfig: { path: 'config.json', sha256: hash(files['config.json']) }
      }]
    };
    const manifestPath = path.join(temp, 'run-manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyBenchmarkProvenance(manifestPath, temp), /Mutable model aliases/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('scoring contract marks missing dimensions incomplete and safety failures decisive', () => {
  assert.equal(evaluateScoringRecord({ assertions: [] }).verdict, 'INCOMPLETE');
  assert.equal(evaluateScoringRecord({
    assertions: [{ id: 'schema', passed: true }],
    safetyViolation: true
  }).verdict, 'FAIL');
  assert.equal(evaluateScoringRecord({
    assertions: [{ id: 'schema', passed: true }]
  }).verdict, 'BLOCKED');
  assert.equal(evaluateScoringRecord({
    assertions: [{ id: 'schema', passed: true }],
    humanReview: {
      reviewerId: 'reviewer-fixture', rubricVersion: 'rubric-1',
      blindCandidateId: 'candidate-blind-a', score: 4,
      rationale: 'Synthetic fixture review.'
    }
  }).verdict, 'PASS');
  assert.throws(
    () => assertModelInputHasNoScoringOracle({
      prompt: 'fixture', nested: { expectedAnswer: 'secret' }
    }),
    /Scoring oracle leaked/
  );
});

test('economics includes failed and timed-out attempts in the denominator', () => {
  const summary = summarizeBenchmarkRun({
    modelInvocation: false, providerCalls: 0,
    tasks: [
      { taskId: 'a', status: 'completed', accepted: true, latencyMs: 100 },
      { taskId: 'b', status: 'failed', accepted: false, latencyMs: 200 },
      { taskId: 'c', status: 'timeout', accepted: false, latencyMs: 300 }
    ]
  });
  assert.equal(summary.attempted, 3);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.timedOut, 1);
  const cost = calculateLocalCostZar({
    energyKwh: 0.5, tariffZarPerKwh: 3.5,
    hardwareAmortizationZar: 2,
    attemptedTasks: summary.attempted, acceptedTasks: summary.accepted
  });
  assert.equal(cost.totalCostZar, 3.75);
  assert.equal(cost.costPerAttemptZar, 1.25);
  assert.equal(cost.costPerAcceptedTaskZar, 3.75);
});

test('economics blocks invented costs and repeatability mismatches', () => {
  assert.equal(calculateLocalCostZar({
    attemptedTasks: 2, acceptedTasks: 1
  }).status, 'BLOCKED');
  const first = {
    datasetSha256: 'a', promptConfigSha256: 'b',
    candidateIdentity: 'c', runtimeIdentity: 'd',
    hardwareIdentity: 'e', seed: 7, concurrency: 1
  };
  assert.equal(compareRepeatability(first, { ...first }).verdict, 'CONFIGURATION_MATCH');
  assert.equal(compareRepeatability(first, { ...first, seed: 8 }).verdict, 'NOT_COMPARABLE');
});

test('provenance validator rejects secret-bearing non-secret config', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-provenance-secret-'));
  try {
    const files = {
      'package-lock.json': 'lock',
      'prompt.txt': 'prompt',
      'config.json': '{"api_key":"synthetic-secret-value-123456"}'
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(temp, name), content);
    }
    const manifest = {
      schemaVersion: '1.0.0', modelInvocation: false,
      harnessCommit: 'a'.repeat(40),
      dataset: { manifestSha256: 'b'.repeat(64) },
      runtimeLock: { path: 'package-lock.json', sha256: hash('lock') },
      candidates: [{
        id: 'fixture', provider: 'fixture', model: 'fixture-model-v1',
        immutableRevision: 'sha256:' + 'c'.repeat(64),
        revisionKind: 'digest', runtimeVersion: 'fixture-1',
        promptTemplate: { path: 'prompt.txt', sha256: hash('prompt') },
        nonSecretConfig: {
          path: 'config.json', sha256: hash(files['config.json'])
        }
      }]
    };
    const manifestPath = path.join(temp, 'run-manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyBenchmarkProvenance(manifestPath, temp),
      /Potential secret material/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
