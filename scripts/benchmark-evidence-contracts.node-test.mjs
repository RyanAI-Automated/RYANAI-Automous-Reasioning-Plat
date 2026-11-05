import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
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

const custodyRoles = {
  aclEvidence: 'data-custodian',
  accessAudit: 'security-reviewer',
  contaminationReview: 'contamination-reviewer'
};

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonicalJson(value[key])
  ).join(',') + '}';
}

async function createHeldoutBundle(temp, options = {}) {
  const evidenceRoot = path.join(temp, 'evidence');
  await mkdir(evidenceRoot, { recursive: true });
  const datasetVersion = options.datasetVersion ?? 'synthetic-heldout-v1';
  const datasetSha256 = options.datasetSha256 ?? hash('synthetic-heldout-content-v1');
  const storageRef = 'external://synthetic-evaluator-vault/heldout-v1';
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + (options.expired ? -1_000 : 3_600_000)).toISOString();
  const keys = [];
  const attestations = {};
  for (const [kind, role] of Object.entries(custodyRoles)) {
    const pair = generateKeyPairSync('ed25519');
    const publicKeyDer = pair.publicKey.export({ type: 'spki', format: 'der' });
    const keyId = hash(publicKeyDer);
    const principalId = options.sharedPrincipal ? 'synthetic-shared-principal' : 'synthetic-' + role;
    keys.push({
      keyId, role, principalId,
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      revoked: options.revokedRole === role
    });
    const payload = {
      schemaVersion: '1.0.0',
      evidenceType: kind,
      datasetVersion,
      heldoutDatasetSha256: datasetSha256,
      storageRef,
      evaluatorOnly: true,
      modelRunnerAccess: false,
      issuedAt,
      expiresAt,
      keyId,
      principalId,
      algorithm: 'Ed25519',
      ...(kind === 'aclEvidence' ? {
        acl: {
          enforced: true, evaluatorOnly: true, modelRunnerDenied: true,
          writesDisabled: true, auditEnabled: true, policyVersion: 'acl-v1'
        }
      } : {}),
      ...(kind === 'accessAudit' ? {
        audit: {
          eventCount: 1, unauthorizedAccessCount: 0, logSha256: 'a'.repeat(64),
          windowStart: issuedAt, windowEnd: new Date(Date.now()).toISOString()
        }
      } : {}),
      ...(kind === 'contaminationReview' ? {
        review: {
          outcome: 'CLEAN', contaminationFound: false, blindReview: true,
          sourcesReviewed: ['synthetic-source-a']
        }
      } : {})
    };
    let signature = sign(null, Buffer.from(canonicalJson(payload)), pair.privateKey).toString('base64');
    if (options.tamperKind === kind) signature = 'A'.repeat(signature.length);
    const bytes = Buffer.from(JSON.stringify({ ...payload, signature }));
    const fileName = kind + '.json';
    await writeFile(path.join(evidenceRoot, fileName), bytes);
    attestations[kind] = { path: fileName, sha256: hash(bytes) };
  }
  const trustRootsPath = path.join(temp, 'external-trust-roots.json');
  const trustRootsBytes = Buffer.from(JSON.stringify({ schemaVersion: '1.0.0', keys }));
  await writeFile(trustRootsPath, trustRootsBytes);
  return {
    evidenceRoot,
    trustRootsPath,
    trustRootsSha256: hash(trustRootsBytes),
    heldout: {
      storageRef,
      datasetSha256,
      evaluatorOnly: true,
      modelRunnerAccess: false,
      ...attestations
    }
  };
}

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
    const custody = await createHeldoutBundle(temp);
    const manifest = {
      schemaVersion: '1.0.0', visibility: 'DEVELOPMENT_ONLY',
      version: 'synthetic-1',
      files: [{
        path: 'development/tasks.jsonl',
        sha256: hash(task), taskCount: 1
      }],
      heldout: custody.heldout
    };
    await writeFile(path.join(dataset, 'manifest.json'), JSON.stringify(manifest));
    const result = await verifyBenchmarkDataset(
      path.join(dataset, 'manifest.json'), dataset, custody.evidenceRoot,
      custody.trustRootsPath, custody.trustRootsSha256
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
    const custody = await createHeldoutBundle(temp, { datasetVersion: 'synthetic-2' });
    const manifest = {
      schemaVersion: '1.0.0', visibility: 'DEVELOPMENT_ONLY',
      version: 'synthetic-2',
      files: [{
        path: 'development/tasks.jsonl',
        sha256: hash(task), taskCount: 1
      }],
      heldout: custody.heldout
    };
    await writeFile(path.join(dataset, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(
      verifyBenchmarkDataset(
        path.join(dataset, 'manifest.json'), dataset, custody.evidenceRoot,
        custody.trustRootsPath, custody.trustRootsSha256
      ),
      /evaluator-only field/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});


test('held-out custody requires valid independent Ed25519 attestations', async () => {
  for (const options of [
    { tamperKind: 'aclEvidence' },
    { expired: true },
    { sharedPrincipal: true },
    { revokedRole: 'security-reviewer' }
  ]) {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-custody-invalid-'));
    try {
      const dataset = path.join(temp, 'dataset');
      await mkdir(path.join(dataset, 'development'), { recursive: true });
      const task = JSON.stringify({
        taskId: 'synthetic-custody-001', modelInput: { prompt: 'fixture' }, toolPermissions: []
      }) + '\\n';
      await writeFile(path.join(dataset, 'development', 'tasks.jsonl'), task);
      const custody = await createHeldoutBundle(temp, options);
      const manifest = {
        schemaVersion: '1.0.0', visibility: 'DEVELOPMENT_ONLY', version: 'synthetic-heldout-v1',
        files: [{ path: 'development/tasks.jsonl', sha256: hash(task), taskCount: 1 }],
        heldout: custody.heldout
      };
      const manifestPath = path.join(dataset, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest));
      await assert.rejects(
        verifyBenchmarkDataset(
          manifestPath, dataset, custody.evidenceRoot,
          custody.trustRootsPath, custody.trustRootsSha256
        )
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
});

test('held-out custody rejects a trust-root hash that was not pinned out of band', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-custody-unpinned-'));
  try {
    const dataset = path.join(temp, 'dataset');
    await mkdir(path.join(dataset, 'development'), { recursive: true });
    const task = JSON.stringify({
      taskId: 'synthetic-custody-002', modelInput: { prompt: 'fixture' }, toolPermissions: []
    }) + '\\n';
    await writeFile(path.join(dataset, 'development', 'tasks.jsonl'), task);
    const custody = await createHeldoutBundle(temp);
    const manifestPath = path.join(dataset, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: '1.0.0', visibility: 'DEVELOPMENT_ONLY', version: 'synthetic-heldout-v1',
      files: [{ path: 'development/tasks.jsonl', sha256: hash(task), taskCount: 1 }],
      heldout: custody.heldout
    }));
    await assert.rejects(
      verifyBenchmarkDataset(
        manifestPath, dataset, custody.evidenceRoot,
        custody.trustRootsPath, 'f'.repeat(64)
      ),
      /trust-root SHA-256 mismatch/
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
      'dataset-manifest.json': '{"schemaVersion":"1.0.0"}',
      'prompt.txt': 'Synthetic benchmark prompt.',
      'config.json': '{"temperature":0,"maxOutputTokens":128}'
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(temp, name), content);
    }
    const manifest = {
      schemaVersion: '1.0.0', modelInvocation: false,
      harnessCommit: 'a'.repeat(40),
      dataset: {
        manifestPath: 'dataset-manifest.json',
        manifestSha256: hash(files['dataset-manifest.json'])
      },
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
      'dataset-manifest.json': 'synthetic-dataset-manifest',
      'prompt.txt': 'prompt',
      'config.json': '{"api_key":"do-not-use-real-secrets"}'
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(temp, name), content);
    }
    const manifest = {
      schemaVersion: '1.0.0', modelInvocation: false,
      harnessCommit: 'a'.repeat(40),
      dataset: {
        manifestPath: 'dataset-manifest.json',
        manifestSha256: hash(files['dataset-manifest.json'])
      },
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
      'dataset-manifest.json': 'synthetic-dataset-manifest',
      'prompt.txt': 'prompt',
      'config.json': '{"api_key":"synthetic-secret-value-123456"}'
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(temp, name), content);
    }
    const manifest = {
      schemaVersion: '1.0.0', modelInvocation: false,
      harnessCommit: 'a'.repeat(40),
      dataset: {
        manifestPath: 'dataset-manifest.json',
        manifestSha256: hash(files['dataset-manifest.json'])
      },
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

test('provenance validator rejects a tampered dataset manifest hash', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-provenance-dataset-hash-'));
  try {
    const files = {
      'package-lock.json': 'lock',
      'dataset-manifest.json': 'actual-dataset-manifest',
      'prompt.txt': 'prompt',
      'config.json': '{"temperature":0}'
    };
    for (const [name, value] of Object.entries(files)) await writeFile(path.join(temp, name), value);
    const manifest = {
      schemaVersion: '1.0.0', modelInvocation: false,
      harnessCommit: 'a'.repeat(40),
      dataset: { manifestPath: 'dataset-manifest.json', manifestSha256: 'b'.repeat(64) },
      runtimeLock: { path: 'package-lock.json', sha256: hash('lock') },
      candidates: [{
        id: 'fixture', provider: 'fixture', model: 'fixture-v1',
        immutableRevision: 'sha256:' + 'c'.repeat(64), revisionKind: 'digest',
        runtimeVersion: 'fixture-runtime-1',
        promptTemplate: { path: 'prompt.txt', sha256: hash('prompt') },
        nonSecretConfig: { path: 'config.json', sha256: hash(files['config.json']) }
      }]
    };
    const manifestPath = path.join(temp, 'run-manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyBenchmarkProvenance(manifestPath, temp),
      /Provenance SHA-256 mismatch: dataset-manifest.json/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('provenance validator rejects nested symlink escape', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-provenance-symlink-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'ryanai-provenance-outside-'));
  try {
    await mkdir(path.join(temp, 'linked'));
    await writeFile(path.join(outside, 'prompt.txt'), 'prompt');
    await writeFile(path.join(temp, 'package-lock.json'), 'lock');
    await writeFile(path.join(temp, 'dataset-manifest.json'), 'dataset');
    await writeFile(path.join(temp, 'config.json'), '{"temperature":0}');
    await writeFile(path.join(temp, 'run-manifest.json'), JSON.stringify({
      schemaVersion: '1.0.0', modelInvocation: false,
      harnessCommit: 'a'.repeat(40),
      dataset: { manifestPath: 'dataset-manifest.json', manifestSha256: hash('dataset') },
      runtimeLock: { path: 'package-lock.json', sha256: hash('lock') },
      candidates: [{
        id: 'fixture', provider: 'fixture', model: 'fixture-v1',
        immutableRevision: 'sha256:' + 'c'.repeat(64), revisionKind: 'digest',
        runtimeVersion: 'fixture-runtime-1',
        promptTemplate: { path: 'linked/prompt.txt', sha256: hash('prompt') },
        nonSecretConfig: { path: 'config.json', sha256: hash('{"temperature":0}') }
      }]
    }));
    const { symlink } = await import('node:fs/promises');
    await symlink(outside, path.join(temp, 'linked'), 'dir');
    await assert.rejects(
      verifyBenchmarkProvenance(path.join(temp, 'run-manifest.json'), temp),
      /Provenance symlinks are forbidden/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
