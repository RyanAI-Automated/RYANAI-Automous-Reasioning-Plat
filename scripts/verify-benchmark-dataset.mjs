import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => /^[a-f0-9]{64}$/.test(value ?? '');

async function readSafeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error('Evidence paths must be non-empty relative paths.');
  }
  const base = await realpath(root);
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) {
    throw new Error('Path traversal outside the dataset root is forbidden.');
  }
  const parts = path.relative(base, target).split(path.sep);
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error('Symlinks are not permitted in benchmark evidence paths.');
    }
  }
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error('Dataset artifacts must be non-empty regular files.');
  }
  return readFile(target);
}

const forbiddenKeys = new Set([
  'answer', 'expectedanswer', 'referenceanswer', 'gold', 'goldlabel',
  'scoringkey', 'hiddenrubric', 'evaluatornotes'
]);

function inspectTask(task, ids) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error('Every JSONL task must be an object.');
  }
  if (typeof task.taskId !== 'string' || !task.taskId.trim()) {
    throw new Error('Every task requires a stable opaque taskId.');
  }
  if (ids.has(task.taskId)) throw new Error('Duplicate taskId: ' + task.taskId);
  ids.add(task.taskId);
  if (!task.modelInput || typeof task.modelInput !== 'object') {
    throw new Error('Every task requires a modelInput object.');
  }
  if (!Array.isArray(task.toolPermissions) || task.toolPermissions.length !== 0) {
    throw new Error('Tool permissions must be explicitly empty in the initial harness.');
  }
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase().replace(/[^a-z]/g, ''))) {
        throw new Error('Model-visible task contains evaluator-only field: ' + key);
      }
      visit(child);
    }
  };
  visit(task.modelInput);
}

export async function verifyBenchmarkDataset(manifestPath, datasetRoot, evidenceRoot) {
  const manifestBytes = await readSafeFile(path.dirname(manifestPath), path.basename(manifestPath));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== '1.0.0' || manifest.visibility !== 'DEVELOPMENT_ONLY') {
    throw new Error('Dataset manifest must be version 1.0.0 and development-only.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Dataset manifest must list at least one development file.');
  }
  const ids = new Set();
  const files = [];
  for (const entry of manifest.files) {
    if (!entry.path.startsWith('development/')) {
      throw new Error('Only development/ files may be mounted for model-visible tasks.');
    }
    if (!isHash(entry.sha256)) throw new Error('Invalid SHA-256 for ' + entry.path);
    const bytes = await readSafeFile(datasetRoot, entry.path);
    const digest = sha256(bytes);
    if (digest !== entry.sha256) throw new Error('SHA-256 mismatch: ' + entry.path);
    const lines = bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length !== entry.taskCount) throw new Error('Task count mismatch: ' + entry.path);
    for (const line of lines) inspectTask(JSON.parse(line), ids);
    files.push({ path: entry.path, sha256: digest, taskCount: lines.length });
  }
  const heldout = manifest.heldout;
  if (!heldout || heldout.evaluatorOnly !== true || heldout.modelRunnerAccess !== false) {
    throw new Error('Held-out set must be evaluator-only and inaccessible to model runners.');
  }
  if (typeof heldout.storageRef !== 'string' || !heldout.storageRef.startsWith('external://')) {
    throw new Error('Held-out contents must live outside the repository dataset tree.');
  }
  const attestations = ['aclEvidence', 'accessAudit', 'contaminationReview'];
  const heldoutEvidence = [];
  for (const key of attestations) {
    const item = heldout[key];
    if (!item || !isHash(item.sha256) || typeof item.path !== 'string') {
      throw new Error('Missing held-out control evidence: ' + key);
    }
    const bytes = await readSafeFile(evidenceRoot, item.path);
    const digest = sha256(bytes);
    if (digest !== item.sha256) throw new Error('Held-out evidence hash mismatch: ' + key);
    heldoutEvidence.push({ kind: key, path: item.path, sha256: digest });
  }
  return {
    status: 'STRUCTURE_AND_HASHES_VALID',
    gateVerdict: 'BLOCKED',
    datasetVersion: manifest.version,
    taskCount: ids.size,
    files,
    heldoutEvidence,
    heldoutControls: 'ARTIFACTS_HASHED_ONLY_EXTERNAL_ACL_REQUIRES_INDEPENDENT_REVIEW',
    modelInvocation: false
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [manifest, datasetRoot, evidenceRoot] = process.argv.slice(2);
  if (!manifest || !datasetRoot || !evidenceRoot) {
    console.error('Usage: node scripts/verify-benchmark-dataset.mjs <manifest> <dataset-root> <evidence-root>');
    process.exit(2);
  }
  try {
    const result = await verifyBenchmarkDataset(manifest, datasetRoot, evidenceRoot);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('BLOCKED ' + error.message);
    process.exit(1);
  }
}
