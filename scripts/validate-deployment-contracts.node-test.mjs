import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('three-platform deployment contract validator passes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-deployment-contracts.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Deployment contract validation: 18\\/18 passed\./);
});
