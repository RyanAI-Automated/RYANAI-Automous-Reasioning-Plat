import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateRepositoryInventory } from './repository-inventory.mjs';

test('inventories package scripts, repository scripts, and workflows without executing them', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'ryanai-inventory-'));
  try {
    await mkdir(path.join(rootDir, 'scripts'), { recursive: true });
    await mkdir(path.join(rootDir, '.github', 'workflows'), { recursive: true });
    await mkdir(path.join(rootDir, 'node_modules', 'dependency', 'scripts'), { recursive: true });
    await writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
      name: 'fixture-root',
      packageManager: 'npm@10.9.2',
      engines: { node: '24.x' },
      scripts: { test: 'node --test', build: 'tsc && vite build' },
    }));
    await writeFile(path.join(rootDir, 'scripts', 'audit.mjs'), 'throw new Error("must not execute");');
    await writeFile(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    await writeFile(path.join(rootDir, 'node_modules', 'dependency', 'scripts', 'ignored.js'), 'ignored');
    
    const report = await generateRepositoryInventory({ rootDir });
    assert.equal(report.mode, 'READ_ONLY_STATIC_INVENTORY');
    assert.equal(report.commandsExecuted, false);
    assert.equal(report.environmentValuesRead, false);
    assert.equal(report.packageScriptCount, 2);
    assert.deepEqual(report.packages[0].scripts.map((item) => item.name), ['build', 'test']);
    assert.ok(report.packages[0].scripts.every((item) => item.status === 'NOT_EXECUTED'));
    assert.deepEqual(report.repositoryScripts.map((item) => item.path), ['scripts/audit.mjs']);
    assert.deepEqual(report.workflows.map((item) => item.path), ['.github/workflows/ci.yml']);
    assert.ok(!JSON.stringify(report).includes('ignored.js'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('reports malformed package manifests rather than silently omitting them', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'ryanai-inventory-invalid-'));
  try {
    await writeFile(path.join(rootDir, 'package.json'), '{invalid');
    const report = await generateRepositoryInventory({ rootDir });
    assert.equal(report.packages.length, 1);
    assert.equal(report.packages[0].status, 'INVALID_MANIFEST');
    assert.equal(report.packages[0].scripts.length, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
