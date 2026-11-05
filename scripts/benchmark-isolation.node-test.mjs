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
  assert.equal(contract.container.hostEnvironmentPassed, false);
  assert.equal(contract.container.repositoryMount, 'two-file-allowlist');
  assert.equal(contract.successMeaning, 'HARNESS_PASS_ONLY_NOT_GATE_PASS');
  assert.ok(contract.requiredChecks.includes('public-ip-egress-denied'));
  assert.ok(contract.requiredChecks.includes('public-dns-denied'));
  assert.ok(contract.requiredChecks.includes('only-loopback-network-interface'));
});

test('container runner passes no host environment and mounts only two allowlisted files', async () => {
  const runner = await readFile('scripts/benchmark-isolation-container.sh', 'utf8');
  assert.match(runner, /--network=none/);
  assert.match(runner, /--read-only/);
  assert.match(runner, /--cap-drop=ALL/);
  assert.match(runner, /--security-opt=no-new-privileges:true/);
  assert.match(runner, /--user=10001:10001/);
  assert.match(runner, /benchmark-isolation-container\.mjs,readonly/);
  assert.match(runner, /local-isolation-policy\.json,readonly/);
  assert.doesNotMatch(runner, /src=\$\(pwd\)|--env-file|--env\s| -e\s|docker\.sock/);
});

test('isolation probes reject connection-refused as evidence of a blocked route', async () => {
  const probe = await readFile('scripts/benchmark-isolation-container.mjs', 'utf8');
  assert.match(probe, /DENIED_NETWORK_CODES/);
  assert.match(probe, /ENETUNREACH/);
  assert.match(probe, /EHOSTUNREACH/);
  assert.doesNotMatch(probe, /'ECONNREFUSED'\s*,?\s*'ETIMEDOUT'/);
  assert.match(probe, /resolver\.setServers\(\['1\.1\.1\.1'\]\)/);
  assert.match(probe, /only-loopback-network-interface/);
  assert.match(probe, /HARNESS_PASS_ONLY_NOT_GATE_PASS/);
});

test('isolation probe exercises positive loopback and negative public/private egress', async () => {
  const probe = await readFile('scripts/benchmark-isolation-container.mjs', 'utf8');
  for (const marker of [
    "'127.0.0.1'",
    "'::1'",
    "'1.1.1.1'",
    "'10.0.0.1'",
    "'example.com'",
    "'host.docker.internal'",
    'credential-environment-absent',
    'only-loopback-network-interface',
    'HARNESS_PASS_ONLY_NOT_GATE_PASS'
  ]) assert.ok(probe.includes(marker), `missing isolation assertion: ${marker}`);
  assert.match(probe, /modelInvocation:\s*false/);
});
