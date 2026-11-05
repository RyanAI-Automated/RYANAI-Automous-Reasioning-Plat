import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => /^[a-f0-9]{64}$/.test(value ?? '');
const mutableAliases = new Set(['latest', 'default', 'stable', 'auto']);

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

export async function verifyBenchmarkProvenance(manifestPath, root) {
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
  return {
    status: 'PROVENANCE_HASHES_VALID',
    gateVerdict: 'BLOCKED',
    harnessCommit: manifest.harnessCommit,
    runtimeLockSha256: lock.sha256,
    datasetManifestSha256: manifest.dataset.manifestSha256,
    candidates,
    modelInvocation: false,
    note: 'Hashes and pinned identifiers are checked; provider-side revision claims require independent confirmation.'
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [manifest, root] = process.argv.slice(2);
  if (!manifest || !root) {
    console.error('Usage: node scripts/verify-benchmark-provenance.mjs <run-manifest> <artifact-root>');
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(await verifyBenchmarkProvenance(manifest, root), null, 2));
  } catch (error) {
    console.error('BLOCKED ' + error.message);
    process.exit(1);
  }
}
