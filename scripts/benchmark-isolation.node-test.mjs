import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('isolation harness contract requires network-disabled, hardened container execution', async () => {
  const contract = JSON.parse(await readFile('benchmarks/contracts/isolation-harness-contract.json', 'utf8'));
  assert.equal(contract.modelInvocation, false);
  assert.equal(contract.container.networkMode, 'none');
  assert.equal(contract.container.readOnlyRootFilesystem, true);
  assert.equal(contract.container.dropAllCapabilities, true);
  assert.equal(contract.container.noNewPrivileges, true);
  assert.equal(contract.container.dockerSocketMounted, false);
  assert.equal(contract.successMeaning, 'HARNESS_PASS_ONLY_NOT_GATE_PASS');
  assert.ok(contract.requiredChecks.includes('public-ip-egress-denied'));
  assert.ok(contract.requiredChecks.includes('public-dns-denied'));
});

test('container runner does not pass host environment, mounts repository read-only and disables networking', async () => {
  const runner = await readFile('scripts/benchmark-isolation-container.sh', 'utf8');
  assert.match(runner, /--network=none/);
  assert.match(runner, /--read-only/);
  assert.match(runner, /--cap-drop=ALL/);
  assert.match(runner, /--security-opt=no-new-privileges:true/);
  assert.match(runner, /readonly/);
  assert.match(runner, /--user=10001:10001/);
  assert.doesNotMatch(runner, /--env-file|--env\s| -e\s|docker\.sock/);
});

test('isolation probe tests loopback while denying public, private and DNS egress', async () => {
  const probe = await readFile('scripts/benchmark-isolation-container.mjs', 'utf8');
  for (const marker of [
    '127.0.0.1',
    "'::1'",
    "'1.1.1.1'",
    "'10.0.0.1'",
    "'example.com'",
    "'host.docker.internal'",
    'credential-environment-absent',
    'HARNESS_PASS_ONLY_NOT_GATE_PASS'
  ]) assert.ok(probe.includes(marker), `missing isolation assertion: ${marker}`);
  assert.match(probe, /modelInvocation:\s*false/);
});
