import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [
  probeStdoutPath,
  probeStderrPath,
  pullStderrPath,
  inspectStderrPath,
  probeExitRaw,
  pullExitRaw,
  inspectExitRaw,
  testedCommit,
  imageDigest
] = process.argv.slice(2);

if ([probeStdoutPath, probeStderrPath, pullStderrPath, inspectStderrPath,
  probeExitRaw, pullExitRaw, inspectExitRaw, testedCommit, imageDigest].some(value => value === undefined)) {
  console.error('Usage: node scripts/benchmark-isolation-evidence.mjs <probe-stdout> <probe-stderr> <pull-stderr> <inspect-stderr> <probe-exit> <pull-exit> <inspect-exit> <tested-commit> <image-digest>');
  process.exit(2);
}

const readOptional = async file => {
  try { return await readFile(file); } catch { return Buffer.alloc(0); }
};
const [probeStdout, probeStderr, pullStderr, inspectStderr] = await Promise.all([
  readOptional(probeStdoutPath),
  readOptional(probeStderrPath),
  readOptional(pullStderrPath),
  readOptional(inspectStderrPath)
]);
const asExitCode = value => Number.isInteger(Number(value)) ? Number(value) : -1;
const probeExitCode = asExitCode(probeExitRaw);
const pullExitCode = asExitCode(pullExitRaw);
const inspectExitCode = asExitCode(inspectExitRaw);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const shortText = bytes => bytes.toString('utf8').trim().slice(0, 1500);
let probeResult = null;
let probeParseError = null;
if (probeStdout.length > 0) {
  try {
    probeResult = JSON.parse(probeStdout.toString('utf8'));
  } catch (error) {
    probeParseError = error instanceof Error ? error.message : String(error);
  }
}

const image = 'node:24-alpine';
const root = process.cwd();
const probeScript = 'scripts/benchmark-isolation-container.mjs';
const policyFile = 'benchmarks/contracts/local-isolation-policy.json';
const dockerRunArgv = [
  'docker', 'run', '--rm', '--pull=never', '--network=none', '--cap-drop=ALL',
  '--security-opt=no-new-privileges:true', '--read-only', '--pids-limit=64',
  '--memory=256m', '--cpus=1', '--user=10001:10001',
  '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m',
  `--mount=type=bind,src=${root}/${probeScript},dst=/workspace/benchmark-isolation-container.mjs,readonly`,
  `--mount=type=bind,src=${root}/${policyFile},dst=/workspace/local-isolation-policy.json,readonly`,
  '--workdir=/workspace', imageDigest, 'node',
  '/workspace/benchmark-isolation-container.mjs', imageDigest
];
const checks = Array.isArray(probeResult?.checks) ? probeResult.checks : [];
const requiredCheckNames = [
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
const reportedCheckNames = checks.map(check => check.name);
const missingChecks = requiredCheckNames.filter(name => !reportedCheckNames.includes(name));
const failures = [];
if (!/^[a-f0-9]{40}$/i.test(testedCommit)) failures.push('The checked-out Git commit SHA is missing or invalid.');
if (pullExitCode !== 0) failures.push(`docker pull exited ${pullExitCode}.`);
if (inspectExitCode !== 0) failures.push(`docker image inspect exited ${inspectExitCode}.`);
if (!/^node@sha256:[a-f0-9]{64}$/i.test(imageDigest)) failures.push('The immutable Node image digest is missing or invalid.');
if (probeExitCode !== 0) failures.push(`The isolated probe container exited ${probeExitCode}.`);
if (probeParseError) failures.push(`Probe stdout is not valid JSON: ${probeParseError}`);
if (!probeResult) failures.push('No structured probe result was produced.');
if (probeResult && (
  probeResult.networkMode !== 'none' ||
  probeResult.modelInvocation !== false ||
  probeResult.verdict !== 'HARNESS_PASS_ONLY_NOT_GATE_PASS' ||
  probeResult.containerImageDigest !== imageDigest
)) failures.push('Probe result does not attest the expected image digest and harness-only, no-network, no-model mode.');
if (missingChecks.length > 0) failures.push('Required probe checks are missing: ' + missingChecks.join(', '));
if (new Set(reportedCheckNames).size !== reportedCheckNames.length) failures.push('Probe result contains duplicate check names.');
for (const check of checks) {
  if (check.status !== 'PASS' || check.exitCode !== 0 || typeof check.command !== 'string' || !check.command || typeof check.observedCode !== 'string' || !check.observedCode) {
    failures.push(`Probe check "${check.name ?? 'unnamed'}" failed or is missing command/exit-code evidence.`);
  }
}

const report = {
  schemaVersion: '1.0.0',
  evidenceType: 'isolated-container-network-boundary-test',
  verdict: failures.length === 0 ? 'HARNESS_PASS_ONLY_NOT_GATE_PASS' : 'HARNESS_FAIL',
  modelInvocation: false,
  providerCalls: 0,
  providerSpendZar: 0,
  testedRevision: {
    gitCommit: testedCommit,
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    githubWorkflow: process.env.GITHUB_WORKFLOW ?? null,
    githubJob: process.env.GITHUB_JOB ?? null,
    githubEvent: process.env.GITHUB_EVENT_NAME ?? null,
    runnerOs: process.env.RUNNER_OS ?? null,
    runnerArch: process.env.RUNNER_ARCH ?? null
  },
  runtime: {
    hostImageReference: image,
    immutableContainerImageDigest: imageDigest || null,
    networkMode: 'none',
    hostEnvironmentPassed: false,
    mountedFiles: [probeScript, 'scripts/benchmark-endpoint-policy.mjs', policyFile],
    repositoryMount: 'three-file-allowlist'
  },
  commands: {
    imagePull: {
      argv: ['docker', 'pull', image],
      exitCode: pullExitCode,
      stderrSha256: sha256(pullStderr),
      stderr: shortText(pullStderr)
    },
    imageDigestInspection: {
      argv: ['docker', 'image', 'inspect', '--format={{index .RepoDigests 0}}', image],
      exitCode: inspectExitCode,
      resolvedDigest: imageDigest || null,
      stderrSha256: sha256(inspectStderr),
      stderr: shortText(inspectStderr)
    },
    isolatedContainer: {
      argv: dockerRunArgv,
      exitCode: probeExitCode,
      stdoutBytes: probeStdout.length,
      stdoutSha256: sha256(probeStdout),
      stderrSha256: sha256(probeStderr),
      stderr: shortText(probeStderr),
      probeCommand: ['node', '/workspace/benchmark-isolation-container.mjs', imageDigest || '<missing-image-digest>']
    }
  },
  probeResult,
  checks,
  failureReasons: failures,
  scopeNote: 'This artifact verifies the disposable CI test container only. It does not certify a production benchmark runner, host network, Ollama runtime, held-out dataset custody, model identity or any of the six benchmark readiness gates.'
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (failures.length > 0) process.exitCode = 1;
