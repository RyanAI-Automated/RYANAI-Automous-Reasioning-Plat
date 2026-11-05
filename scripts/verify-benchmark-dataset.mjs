import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => /^[a-f0-9]{64}$/.test(value ?? '');
const MAX_ATTESTATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const REQUIRED_ROLES = Object.freeze({
  aclEvidence: 'data-custodian',
  accessAudit: 'security-reviewer',
  contaminationReview: 'contamination-reviewer'
});

async function readSafeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) ||
      relative.includes(String.fromCharCode(92)) || path.posix.normalize(relative) !== relative ||
      relative.split('/').includes('..') || relative === '.') {
    throw new Error('Evidence paths must be normalized non-empty relative paths.');
  }
  const base = await realpath(root);
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) {
    throw new Error('Path traversal outside the evidence root is forbidden.');
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

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Attestation contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  throw new Error('Attestation contains an unsupported value.');
}

function assertAttestationScope(record, kind, manifest, heldout) {
  if (record.schemaVersion !== '1.0.0' || record.evidenceType !== kind ||
      record.datasetVersion !== manifest.version ||
      record.heldoutDatasetSha256 !== heldout.datasetSha256 ||
      record.storageRef !== heldout.storageRef ||
      record.evaluatorOnly !== true || record.modelRunnerAccess !== false) {
    throw new Error('Held-out attestation scope does not match the manifest: ' + kind);
  }
  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  const now = Date.now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now + FUTURE_CLOCK_SKEW_MS || expiresAt <= now ||
      expiresAt <= issuedAt || expiresAt - issuedAt > MAX_ATTESTATION_AGE_MS) {
    throw new Error('Held-out attestation is expired, invalidly dated, or outside the maximum validity window: ' + kind);
  }
  if (kind === 'aclEvidence') {
    if (record.acl?.enforced !== true || record.acl?.evaluatorOnly !== true ||
        record.acl?.modelRunnerDenied !== true || record.acl?.writesDisabled !== true ||
        record.acl?.auditEnabled !== true || typeof record.acl?.policyVersion !== 'string' ||
        !record.acl.policyVersion.trim()) {
      throw new Error('Held-out ACL attestation lacks required access-control claims.');
    }
  } else if (kind === 'accessAudit') {
    if (!Number.isInteger(record.audit?.eventCount) || record.audit.eventCount < 0 ||
        record.audit?.unauthorizedAccessCount !== 0 || !isHash(record.audit?.logSha256) ||
        !Number.isFinite(Date.parse(record.audit?.windowStart)) ||
        !Number.isFinite(Date.parse(record.audit?.windowEnd)) ||
        Date.parse(record.audit.windowEnd) < Date.parse(record.audit.windowStart)) {
      throw new Error('Held-out access-audit attestation is incomplete or reports unauthorized access.');
    }
  } else if (kind === 'contaminationReview') {
    if (record.review?.outcome !== 'CLEAN' || record.review?.contaminationFound !== false ||
        record.review?.blindReview !== true || !Array.isArray(record.review?.sourcesReviewed) ||
        record.review.sourcesReviewed.length === 0 ||
        record.review.sourcesReviewed.some(source => typeof source !== 'string' || !source.trim())) {
      throw new Error('Held-out contamination review is incomplete or reports contamination.');
    }
  }
}

function validateTrustRoots(trustRoots) {
  if (trustRoots?.schemaVersion !== '1.0.0' || !Array.isArray(trustRoots.keys) || trustRoots.keys.length === 0) {
    throw new Error('An externally pinned Ed25519 trust-root file is required.');
  }
  const keys = new Map();
  for (const item of trustRoots.keys) {
    if (!item || typeof item.keyId !== 'string' || !item.keyId ||
        typeof item.principalId !== 'string' || !item.principalId ||
        typeof item.role !== 'string' || typeof item.publicKeyPem !== 'string' ||
        item.revoked === true || keys.has(item.keyId)) {
      throw new Error('Trust roots contain a missing, revoked, or duplicate key identity.');
    }
    const publicKey = createPublicKey(item.publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Held-out custody trust roots must use Ed25519 keys.');
    }
    const fingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
    if (fingerprint !== item.keyId) throw new Error('Trust-root key fingerprint mismatch.');
    keys.set(item.keyId, { ...item, publicKey });
  }
  return keys;
}

function verifyCustodyAttestation(bytes, kind, manifest, heldout, trustedKeys, usedPrincipals, usedKeys) {
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Held-out custody evidence must be a signed JSON attestation: ' + kind);
  }
  assertAttestationScope(record, kind, manifest, heldout);
  const key = trustedKeys.get(record.keyId);
  if (!key || key.revoked === true || key.role !== REQUIRED_ROLES[kind] ||
      key.principalId !== record.principalId || record.algorithm !== 'Ed25519') {
    throw new Error('Held-out attestation signer is not trusted for the required independent role: ' + kind);
  }
  if (usedKeys.has(record.keyId) || usedPrincipals.has(record.principalId)) {
    throw new Error('Held-out custody attestations must have independent signers.');
  }
  if (typeof record.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.signature)) {
    throw new Error('Held-out attestation signature is missing or malformed: ' + kind);
  }
  const signature = Buffer.from(record.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== record.signature) {
    throw new Error('Held-out attestation signature encoding is invalid: ' + kind);
  }
  const { signature: _signature, ...payload } = record;
  if (!verifySignature(null, Buffer.from(canonicalJson(payload)), key.publicKey, signature)) {
    throw new Error('Held-out attestation signature verification failed: ' + kind);
  }
  usedKeys.add(record.keyId);
  usedPrincipals.add(record.principalId);
  return {
    kind,
    principalId: record.principalId,
    keyId: record.keyId,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt
  };
}

async function isInside(root, candidate) {
  const base = await realpath(root);
  const target = await realpath(candidate);
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) &&
    relative !== '..' && !path.isAbsolute(relative));
}

export async function verifyBenchmarkDataset(
  manifestPath, datasetRoot, evidenceRoot, trustRootsPath, trustRootsSha256
) {
  if (typeof trustRootsPath !== 'string' || !trustRootsPath || !isHash(trustRootsSha256)) {
    throw new Error('An externally pinned trust-root path and SHA-256 are required for held-out custody.');
  }
  if (await isInside(datasetRoot, trustRootsPath) || await isInside(evidenceRoot, trustRootsPath)) {
    throw new Error('Trust roots must be supplied outside the dataset and evidence directories.');
  }
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
    if (typeof entry.path !== 'string' || !entry.path.startsWith('development/') ||
        entry.path.includes(String.fromCharCode(92)) || entry.path.split('/').includes('..') ||
        path.posix.normalize(entry.path) !== entry.path) {
      throw new Error('Only normalized development/ paths may be model-visible.');
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
  if (!heldout || heldout.evaluatorOnly !== true || heldout.modelRunnerAccess !== false ||
      typeof heldout.datasetSha256 !== 'string' || !isHash(heldout.datasetSha256)) {
    throw new Error('Held-out set must declare an external SHA-256 and deny model-runner access.');
  }
  if (typeof heldout.storageRef !== 'string' || !heldout.storageRef.startsWith('external://')) {
    throw new Error('Held-out contents must live outside the repository dataset tree.');
  }
  const trustBytes = await readSafeFile(path.dirname(trustRootsPath), path.basename(trustRootsPath));
  if (sha256(trustBytes) !== trustRootsSha256) {
    throw new Error('Externally pinned trust-root SHA-256 mismatch.');
  }
  const trustRoots = JSON.parse(trustBytes.toString('utf8'));
  const trustedKeys = validateTrustRoots(trustRoots);
  const usedPrincipals = new Set();
  const usedKeys = new Set();
  const heldoutEvidence = [];
  for (const [kind] of Object.entries(REQUIRED_ROLES)) {
    const item = heldout[kind];
    if (!item || !isHash(item.sha256) || typeof item.path !== 'string') {
      throw new Error('Missing held-out control evidence: ' + kind);
    }
    const bytes = await readSafeFile(evidenceRoot, item.path);
    const digest = sha256(bytes);
    if (digest !== item.sha256) throw new Error('Held-out evidence hash mismatch: ' + kind);
    const attestation = verifyCustodyAttestation(
      bytes, kind, manifest, heldout, trustedKeys, usedPrincipals, usedKeys
    );
    heldoutEvidence.push({ path: item.path, sha256: digest, ...attestation });
  }
  return {
    status: 'STRUCTURE_HASHES_AND_SIGNATURES_VALID',
    gateVerdict: 'BLOCKED',
    datasetVersion: manifest.version,
    taskCount: ids.size,
    files,
    heldoutEvidence,
    heldoutControls: 'TRUSTED_SIGNATURES_VALIDATED_EXTERNAL_ACL_RUNTIME_STILL_REQUIRES_INDEPENDENT_PROBE',
    modelInvocation: false
  };
}

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
  const forbiddenKeys = new Set([
    'answer', 'expectedanswer', 'referenceanswer', 'gold', 'goldlabel',
    'scoringkey', 'hiddenrubric', 'evaluatornotes'
  ]);
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

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [manifest, datasetRoot, evidenceRoot, trustRootsPath, trustRootsSha256] = process.argv.slice(2);
  if (!manifest || !datasetRoot || !evidenceRoot || !trustRootsPath || !trustRootsSha256) {
    console.error('Usage: node scripts/verify-benchmark-dataset.mjs <manifest> <dataset-root> <evidence-root> <external-trust-roots.json> <trust-roots-sha256>');
    process.exit(2);
  }
  try {
    const result = await verifyBenchmarkDataset(
      manifest, datasetRoot, evidenceRoot, trustRootsPath, trustRootsSha256
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('BLOCKED ' + error.message);
    process.exit(1);
  }
}
