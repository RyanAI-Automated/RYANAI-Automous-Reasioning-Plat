import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => /^[a-f0-9]{64}$/.test(value ?? '');
const mutableAliases = new Set(['latest', 'default', 'stable', 'auto']);
const MAX_ATTESTATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

async function readPinnedFile(root, relative, expectedHash) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) ||
      relative.includes(String.fromCharCode(92)) || path.posix.normalize(relative) !== relative ||
      relative.split('/').includes('..')) {
    throw new Error('Provenance artifact paths must be normalized relative paths.');
  }
  const base = await realpath(root);
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new Error('Provenance path escaped root.');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    const partStat = await lstat(current);
    if (partStat.isSymbolicLink()) throw new Error('Provenance symlinks are forbidden.');
  }
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size === 0) throw new Error('Provenance artifacts must be non-empty regular files.');
  const bytes = await readFile(target);
  if (!isHash(expectedHash) || sha256(bytes) !== expectedHash) {
    throw new Error('Provenance SHA-256 mismatch: ' + relative);
  }
  return bytes;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Provenance attestation contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + canonicalJson(value[key])
    ).join(',') + '}';
  }
  throw new Error('Provenance attestation contains an unsupported value.');
}

function assertNoSecretMaterial(bytes, label) {
  const content = bytes.toString('utf8');
  const patterns = [
    /["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}["']?/i,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
    /\bsk-[A-Za-z0-9]{16,}/
  ];
  if (patterns.some(pattern => pattern.test(content))) {
    throw new Error('Potential secret material found in ' + label);
  }
}

function validateRevision(candidate) {
  const revision = String(candidate.immutableRevision);
  if (mutableAliases.has(String(candidate.model).toLowerCase()) ||
      mutableAliases.has(revision.toLowerCase())) {
    throw new Error('Mutable model aliases are not comparable.');
  }
  if (candidate.revisionKind === 'digest' && !/^sha256:[a-f0-9]{64}$/.test(revision)) {
    throw new Error('Digest revisions must use sha256:<64 lowercase hex characters>.');
  }
  if (candidate.revisionKind === 'commit' && !/^[a-f0-9]{40,64}$/.test(revision)) {
    throw new Error('Commit revisions must be immutable 40-64 character hexadecimal SHAs.');
  }
  if (candidate.revisionKind === 'snapshot' &&
      (revision.length < 8 || /^(latest|default|stable|auto)$/i.test(revision))) {
    throw new Error('Snapshot revisions must be non-empty immutable provider snapshot identifiers.');
  }
}

async function verifyExternalProvenanceAttestation(manifest, candidates, root, trustRootsPath, trustRootsSha256) {
  if (typeof trustRootsPath !== 'string' || !path.isAbsolute(trustRootsPath) || !isHash(trustRootsSha256)) {
    throw new Error('An absolute external trust-root path and independently pinned SHA-256 are required.');
  }
  const artifactRoot = await realpath(root);
  const trustRootRealPath = await realpath(trustRootsPath);
  const relativeTrustPath = path.relative(artifactRoot, trustRootRealPath);
  if (relativeTrustPath === '' || (!relativeTrustPath.startsWith('..' + path.sep) &&
      relativeTrustPath !== '..' && !path.isAbsolute(relativeTrustPath))) {
    throw new Error('Provenance trust roots must be supplied outside the artifact directory.');
  }

  const attestationRef = manifest.provenanceAttestation;
  if (!attestationRef || typeof attestationRef.path !== 'string' || !isHash(attestationRef.sha256)) {
    throw new Error('A signed provenance attestation artifact is required.');
  }
  const bytes = await readPinnedFile(root, attestationRef.path, attestationRef.sha256);
  const rootsBytes = await readPinnedFile(
    path.dirname(trustRootsPath), path.basename(trustRootsPath), trustRootsSha256
  );
  const roots = JSON.parse(rootsBytes.toString('utf8'));
  if (roots?.schemaVersion !== '1.0.0' || !Array.isArray(roots.keys) || roots.keys.length === 0) {
    throw new Error('Externally pinned provenance trust roots are invalid.');
  }

  const keys = new Map();
  for (const item of roots.keys) {
    if (!item || typeof item.keyId !== 'string' || !item.keyId ||
        typeof item.principalId !== 'string' || !item.principalId ||
        item.role !== 'provenance-auditor' || typeof item.publicKeyPem !== 'string' ||
        item.revoked === true || keys.has(item.keyId)) {
      throw new Error('Provenance trust root has a missing, revoked, duplicate or unauthorized key.');
    }
    const publicKey = createPublicKey(item.publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Provenance attestation trust roots must use Ed25519.');
    }
    const fingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
    if (fingerprint !== item.keyId) throw new Error('Provenance trust-root key fingerprint mismatch.');
    keys.set(item.keyId, { ...item, publicKey });
  }

  const record = JSON.parse(bytes.toString('utf8'));
  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  const now = Date.now();
  if (record.schemaVersion !== '1.0.0' || record.evidenceType !== 'benchmark-provenance' ||
      record.algorithm !== 'Ed25519' || record.role !== 'provenance-auditor' ||
      record.harnessCommit !== manifest.harnessCommit ||
      record.datasetManifestSha256 !== manifest.dataset.manifestSha256 ||
      record.runtimeLockSha256 !== manifest.runtimeLock.sha256 ||
      canonicalJson(record.candidates) !== canonicalJson(candidates)) {
    throw new Error('Signed provenance attestation does not match the run manifest and verified artifacts.');
  }
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now + FUTURE_CLOCK_SKEW_MS || expiresAt <= now ||
      expiresAt <= issuedAt || expiresAt - issuedAt > MAX_ATTESTATION_AGE_MS) {
    throw new Error('Provenance attestation is expired, invalidly dated, or outside the maximum validity window.');
  }
  const key = keys.get(record.keyId);
  if (!key || key.principalId !== record.principalId ||
      typeof record.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.signature)) {
    throw new Error('Provenance attestation signer is not trusted.');
  }
  const signature = Buffer.from(record.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== record.signature) {
    throw new Error('Provenance attestation signature encoding is invalid.');
  }
  const { signature: _signature, ...payload } = record;
  if (!verifySignature(null, Buffer.from(canonicalJson(payload)), key.publicKey, signature)) {
    throw new Error('Provenance attestation signature verification failed.');
  }
  return {
    principalId: record.principalId,
    keyId: record.keyId,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    sha256: sha256(bytes)
  };
}

export async function verifyBenchmarkProvenance(
  manifestPath, root, trustRootsPath, trustRootsSha256
) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== '1.0.0' || manifest.modelInvocation !== false) {
    throw new Error('Provenance manifest must be version 1.0.0 and mock-only.');
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.harnessCommit ?? '')) {
    throw new Error('A full immutable harness commit SHA is required.');
  }
  if (!manifest.dataset || typeof manifest.dataset.manifestPath !== 'string' ||
      !isHash(manifest.dataset.manifestSha256)) {
    throw new Error('A versioned dataset manifest path and SHA-256 are required.');
  }
  await readPinnedFile(root, manifest.dataset.manifestPath, manifest.dataset.manifestSha256);
  const lock = manifest.runtimeLock;
  if (!lock) throw new Error('A runtime lockfile identity is required.');
  await readPinnedFile(root, lock.path, lock.sha256);
  if (!Array.isArray(manifest.candidates) || manifest.candidates.length === 0) {
    throw new Error('At least one candidate identity is required.');
  }
  const candidateIds = new Set();
  const candidates = [];
  for (const candidate of manifest.candidates) {
    if (!candidate || typeof candidate.id !== 'string' || !candidate.id.trim() ||
        candidateIds.has(candidate.id) || !candidate.provider || !candidate.model ||
        !candidate.immutableRevision || !candidate.runtimeVersion) {
      throw new Error('Each candidate needs a unique ID, provider, model, immutable revision and runtime.');
    }
    candidateIds.add(candidate.id);
    if (!['digest', 'snapshot', 'commit'].includes(candidate.revisionKind)) {
      throw new Error('Candidate revisionKind must be digest, snapshot or commit.');
    }
    validateRevision(candidate);
    if (!candidate.promptTemplate || !candidate.nonSecretConfig) {
      throw new Error('Prompt template and non-secret configuration identities are required.');
    }
    const prompt = await readPinnedFile(root, candidate.promptTemplate.path, candidate.promptTemplate.sha256);
    const config = await readPinnedFile(root, candidate.nonSecretConfig.path, candidate.nonSecretConfig.sha256);
    assertNoSecretMaterial(config, candidate.nonSecretConfig.path);
    candidates.push({
      id: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      immutableRevision: candidate.immutableRevision,
      revisionKind: candidate.revisionKind,
      runtimeVersion: candidate.runtimeVersion,
      promptSha256: sha256(prompt),
      configSha256: sha256(config)
    });
  }
  const attestation = await verifyExternalProvenanceAttestation(
    manifest, candidates, root, trustRootsPath, trustRootsSha256
  );
  return {
    status: 'SIGNED_PROVENANCE_ATTESTATION_VALID_PROVIDER_REVISION_CONFIRMATION_REQUIRED',
    gateVerdict: 'BLOCKED',
    harnessCommit: manifest.harnessCommit,
    runtimeLockSha256: lock.sha256,
    datasetManifestSha256: manifest.dataset.manifestSha256,
    candidates,
    provenanceAttestation: attestation,
    modelInvocation: false,
    note: 'A separately pinned auditor signature binds local artifact identities. It does not establish provider-side model revision truth; provider attestation and independent review remain required.'
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [manifest, root, trustRootsPath, trustRootsSha256] = process.argv.slice(2);
  if (!manifest || !root || !trustRootsPath || !trustRootsSha256) {
    console.error('Usage: node scripts/verify-benchmark-provenance.mjs <run-manifest> <artifact-root> <external-trust-roots.json> <trust-roots-sha256>');
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(await verifyBenchmarkProvenance(
      manifest, root, trustRootsPath, trustRootsSha256
    ), null, 2));
  } catch (error) {
    console.error('BLOCKED ' + error.message);
    process.exit(1);
  }
}
