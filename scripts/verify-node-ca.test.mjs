import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guardScript = path.join(repositoryRoot, 'scripts', 'verify-node-ca.sh');
const dockerfilePath = path.join(repositoryRoot, 'Dockerfile.api');

function runGuard(extraCaPath) {
  const env = { ...process.env };
  delete env.NODE_EXTRA_CA_CERTS;
  if (extraCaPath !== undefined) env.NODE_EXTRA_CA_CERTS = extraCaPath;

  return spawnSync(
    'sh',
    [guardScript, 'sh', '-c', 'printf startup-allowed'],
    { cwd: repositoryRoot, env, encoding: 'utf8' },
  );
}

test('API image uses system CAs without disabling TLS verification', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8');
  const rootDockerfile = await readFile(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
  for (const image of [dockerfile, rootDockerfile]) {
    assert.match(image, /NODE_USE_SYSTEM_CA=1/);
    assert.doesNotMatch(image, /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/);
    assert.match(image, /scripts\/verify-node-ca\.sh/);
  }
});

test('startup continues when no additional CA bundle is configured', {
  skip: process.platform === 'win32' ? 'The container entrypoint is exercised in Linux CI/WSL.' : false,
}, () => {
  const result = runGuard(undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'startup-allowed');
});

test('startup fails closed when NODE_EXTRA_CA_CERTS points to a missing file', {
  skip: process.platform === 'win32' ? 'The container entrypoint is exercised in Linux CI/WSL.' : false,
}, () => {
  const result = runGuard(path.join(os.tmpdir(), 'ryanai-missing-ca-bundle.pem'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NODE_EXTRA_CA_CERTS is set/);
  assert.doesNotMatch(result.stderr, /password|postgresql:\/\//i);
});

test('startup rejects a file that is not PEM certificate material', {
  skip: process.platform === 'win32' ? 'The container entrypoint is exercised in Linux CI/WSL.' : false,
}, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ryanai-ca-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const caPath = path.join(directory, 'not-a-certificate.pem');
  await writeFile(caPath, 'not a certificate\n', 'utf8');

  const result = runGuard(caPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PEM-encoded certificate bundle/);
});

test('startup accepts a readable PEM bundle and preserves its path for Node', {
  skip: process.platform === 'win32' ? 'The container entrypoint is exercised in Linux CI/WSL.' : false,
}, async (t) => {
  const caPath = path.join(repositoryRoot, 'certs', 'supabase', 'prod-ca-2021.crt');
  const result = runGuard(caPath);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'startup-allowed');
});
