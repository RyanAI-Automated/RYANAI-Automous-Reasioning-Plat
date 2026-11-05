import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const helper = path.join(root, 'scripts/benchmark-isolation-evidence.mjs');
const requiredChecks = [
  'only-loopback-network-interface',
  'ipv4-loopback-fixture',
  'ipv6-loopback-fixture',
  'public-ip-egress-denied',
  'private-lan-egress-denied',
  'public-dns-denied',
  'docker-host-alias-denied',
  'policy-endpoint-allowlist',
  'credential-environment-absent'
];

async function runEvidence({ probeText, probeExitCode = '0' }) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-isolation-evidence-'));
  const files = {
    probeStdout: path.join(temp, 'probe.stdout'),
    probeStderr: path.join(temp, 'probe.stderr'),
    pullStderr: path.join(temp, 'pull.stderr'),
    inspectStderr: path.join(temp, 'inspect.stderr')
  };
  await Promise.all([
    writeFile(files.probeStdout, probeText),
    writeFile(files.probeStderr, ''),
    writeFile(files.pullStderr, ''),
    writeFile(files.inspectStderr, '')
  ]);
  const digest = 'node@sha256:' + 'a'.repeat(64);
  const commit = 'b'.repeat(40);
  const args = [
    helper, files.probeStdout, files.probeStderr, files.pullStderr, files.inspectStderr,
    probeExitCode, '0', '0', commit, digest
  ];
  const run = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2', GITHUB_WORKFLOW: 'Offline Benchmark Contract Tests' }
  });
  return { temp, run, commit, digest };
}

function fixtureProbe() {
  return JSON.stringify({
    schemaVersion: '1.0.0',
    evidenceType: 'isolated-container-network-boundary-test',
    modelInvocation: false,
    networkMode: 'none',
    containerImageDigest: 'node@sha256:' + 'a'.repeat(64),
    checks: requiredChecks.map(name => ({
      name, status: 'PASS', command: 'fixture command', exitCode: 0, observedCode: 'fixture'
    })),
    verdict: 'HARNESS_PASS_ONLY_NOT_GATE_PASS'
  });
}

test('evidence writer emits one valid JSON document with revision, commands and exit codes', async () => {
  const result = await runEvidence({ probeText: fixtureProbe() });
  try {
    assert.equal(result.run.status, 0, result.run.stderr || result.run.stdout);
    const report = JSON.parse(result.run.stdout);
    assert.equal(report.testedRevision.gitCommit, result.commit);
    assert.equal(report.testedRevision.githubRunId, '123456');
    assert.equal(report.runtime.networkMode, 'none');
    assert.equal(report.runtime.immutableContainerImageDigest, result.digest);
    assert.equal(report.commands.imagePull.exitCode, 0);
    assert.equal(report.commands.imageDigestInspection.exitCode, 0);
    assert.equal(report.commands.isolatedContainer.exitCode, 0);
    assert.ok(report.commands.isolatedContainer.argv.includes('--network=none'));
    assert.equal(report.checks.length, requiredChecks.length);
    assert.ok(report.checks.every(check => check.exitCode === 0 && check.command));
    assert.equal(report.verdict, 'HARNESS_PASS_ONLY_NOT_GATE_PASS');
    assert.equal(report.modelInvocation, false);
  } finally {
    await rm(result.temp, { recursive: true, force: true });
  }
});

test('evidence writer preserves valid failure evidence and returns a failing exit code', async () => {
  const result = await runEvidence({ probeText: fixtureProbe(), probeExitCode: '7' });
  try {
    assert.equal(result.run.status, 1);
    const report = JSON.parse(result.run.stdout);
    assert.equal(report.verdict, 'HARNESS_FAIL');
    assert.equal(report.commands.isolatedContainer.exitCode, 7);
    assert.ok(report.failureReasons.some(reason => reason.includes('exited 7')));
  } finally {
    await rm(result.temp, { recursive: true, force: true });
  }
});

test('evidence writer rejects malformed probe output without corrupting report JSON', async () => {
  const result = await runEvidence({ probeText: 'npm banner is not JSON' });
  try {
    assert.equal(result.run.status, 1);
    const report = JSON.parse(result.run.stdout);
    assert.equal(report.verdict, 'HARNESS_FAIL');
    assert.match(report.failureReasons.join(' '), /not valid JSON/);
  } finally {
    await rm(result.temp, { recursive: true, force: true });
  }
});
