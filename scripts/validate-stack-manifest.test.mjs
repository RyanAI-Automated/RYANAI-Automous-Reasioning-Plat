import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validatorPath = path.join(repoRoot, 'scripts', 'validate-stack-manifest.mjs');
const sourceManifest = JSON.parse(readFileSync(path.join(repoRoot, 'stacks', 'ryanai.stack.json'), 'utf8'));
const sourceSchema = readFileSync(path.join(repoRoot, 'stacks', 'ryanai.stack.schema.json'), 'utf8');

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ryanai-stack-validator-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const makeDir = (relative) => mkdirSync(path.join(dir, relative), { recursive: true });
  const put = (relative, value = '# fixture\n') => {
    const destination = path.join(dir, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, value, 'utf8');
  };

  makeDir('stacks');
  put('stacks/ryanai.stack.json', JSON.stringify(structuredClone(sourceManifest), null, 2));
  put('stacks/ryanai.stack.schema.json', sourceSchema);
  put('Dockerfile');
  put('mcp-server/Dockerfile');
  put('k8s/kustomization.yaml');
  put('k8s/ryanai-apps.yaml');
  put('k8s/ryanai-databases.yaml');
  put('.github/workflows/deploy-vercel.yml');
  put('render.yaml');
  put('docker-compose.yml', [
    'services:',
    '  postgres:',
    '    image: postgres',
    '  redis:',
    '    image: redis',
    'volumes:',
    '  postgres_data:',
    '  redis_data:',
    '',
  ].join('\n'));

  return {
    dir,
    manifest: JSON.parse(readFileSync(path.join(dir, 'stacks/ryanai.stack.json'), 'utf8')),
    saveManifest(manifest) {
      writeFileSync(path.join(dir, 'stacks/ryanai.stack.json'), JSON.stringify(manifest, null, 2), 'utf8');
    },
    put,
  };
}

function validate(dir) {
  return spawnSync(process.execPath, [validatorPath], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env },
  });
}

test('accepts the repository stack manifest and schema', (t) => {
  const f = fixture(t);
  const result = validate(f.dir);
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /PASS RyanAI stack manifest, schema, path, and credential policy validated/);
});

test('rejects a service path that traverses outside the repository', (t) => {
  const f = fixture(t);
  f.manifest.services[0].dockerfile = '../outside.Dockerfile';
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dockerfile path must stay inside the repository/);
});

test('rejects a symlink whose target resolves outside the repository', (t) => {
  if (process.platform === 'win32') {
    t.skip('Creating file symlinks can require elevated privileges on Windows');
    return;
  }
  const f = fixture(t);
  const outside = path.join(os.tmpdir(), 'ryanai-validator-outside-' + path.basename(f.dir) + '.txt');
  writeFileSync(outside, 'not a project file', 'utf8');
  t.after(() => rmSync(outside, { force: true }));
  symlinkSync(outside, path.join(f.dir, 'Dockerfile-external'));

  f.manifest.services[0].dockerfile = 'Dockerfile-external';
  f.saveManifest(f.manifest);
  const result = validate(f.dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dockerfile path must stay inside the repository/);
});

test('reports malformed service entries without crashing', (t) => {
  const f = fixture(t);
  f.manifest.services[0] = null;
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Each stack service must be an object/);
  assert.doesNotMatch(result.stderr, /TypeError|Cannot read properties of null/);
});

test('rejects inline credentials and does not echo credential values', (t) => {
  const f = fixture(t);
  f.manifest.services[0].password = 'secret-fixture-value-do-not-print';
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Do not store credentials in stack manifest/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-fixture-value-do-not-print/);
});

test('enforces schema constraints on service ports', (t) => {
  const f = fixture(t);
  f.manifest.services[0].port = 0;
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid port for stack service/);
  assert.match(result.stderr, /Stack manifest does not conform to schema/);
});
