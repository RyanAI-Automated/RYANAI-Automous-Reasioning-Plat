import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Resolver, lookup } from 'node:dns/promises';
import { readdir, readFile } from 'node:fs/promises';
import net from 'node:net';

const policy = JSON.parse(await readFile('./local-isolation-policy.json', 'utf8'));
assert.equal(policy.modelInvocation, false, 'isolation harness must never invoke a model');
assert.equal(policy.failClosed, true);
assert.equal(policy.cloudFallback, false);

const forbiddenEnv = Object.keys(process.env).filter(name =>
  /(API_KEY|ACCESS_TOKEN|DATABASE_URL|DEPLOY_TOKEN|SECRET|CREDENTIAL|PRIVATE_KEY)/i.test(name)
);
assert.deepEqual(
  forbiddenEnv,
  [],
  'provider credentials or production connection variables must not enter the container'
);
const suspiciousValues = Object.entries(process.env)
  .filter(([name, value]) => !/(PATH|VERSION|HOME|NODE_OPTIONS|PWD|HOSTNAME)/i.test(name) &&
    (/(?:Bearer\s+[A-Za-z0-9._~+/-]{12,}|sk-[A-Za-z0-9]{16,})/i.test(value ?? '') ||
     /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}/i.test(value ?? '')))
  .map(([name]) => name);
const allowedContainerEnvNames = new Set([
  'PATH', 'HOME', 'HOSTNAME', 'NODE_VERSION', 'YARN_VERSION', 'PWD', 'TERM'
]);
const unexpectedEnvNames = Object.keys(process.env)
  .filter(name => !allowedContainerEnvNames.has(name))
  .sort();
assert.deepEqual(unexpectedEnvNames, [], 'container environment contains a variable outside the explicit runtime allowlist');
assert.deepEqual(suspiciousValues, [], 'credential-shaped values must not enter the container');

const checks = [];
let failedChecks = 0;
const runCheck = async (name, command, operation) => {
  try {
    const result = await operation();
    checks.push({
      name, status: 'PASS', command, exitCode: 0,
      observedCode: result?.observedCode ?? null,
      detail: result?.detail ?? 'check completed'
    });
  } catch (error) {
    failedChecks += 1;
    checks.push({
      name, status: 'FAIL', command, exitCode: 1,
      observedCode: error?.code ?? error?.name ?? 'UNKNOWN',
      failureReason: error instanceof Error ? error.message : String(error)
    });
  }
};

async function startFixture(host) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fixture: true, modelInvocation: false }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(11434, host, resolve);
  });
  return server;
}

async function requestLoopback(host) {
  return await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: 11434 });
    socket.setTimeout(1200);
    socket.once('connect', () => {
      socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    });
    let response = '';
    socket.on('data', chunk => { response += chunk.toString(); });
    socket.once('end', () => resolve(response));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('loopback fixture request timed out'));
    });
    socket.once('error', reject);
  });
}

const DENIED_NETWORK_CODES = new Set([
  'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'ETIMEOUT', 'EACCES', 'EPERM'
]);

async function expectTcpBlocked(host, port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1200);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`Unexpected network connection to ${host}:${port}`));
    });
    socket.once('error', error => {
      if (DENIED_NETWORK_CODES.has(error.code)) resolve(error.code);
      else reject(new Error(`Connection to ${host}:${port} failed with ${error.code}; this is not proof of egress denial.`));
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve('ETIMEDOUT');
    });
  });
}

async function expectPublicDnsBlocked(hostname) {
  const resolver = new Resolver();
  resolver.setServers(['1.1.1.1']);
  try {
    await Promise.race([
      resolver.resolve4(hostname),
      new Promise((_, reject) => setTimeout(
        () => reject(Object.assign(new Error('DNS probe timed out'), { code: 'ETIMEDOUT' })),
        1500
      ))
    ]);
    throw new Error(`Unexpected public DNS resolution for ${hostname}`);
  } catch (error) {
    if (error.message.startsWith('Unexpected public DNS resolution')) throw error;
    if (DENIED_NETWORK_CODES.has(error.code)) return error.code;
    throw new Error(`Public DNS probe for ${hostname} failed with ${error.code ?? error.message}; egress denial was not established.`);
  }
}

async function expectHostAliasUnavailable(hostname) {
  try {
    const result = await lookup(hostname);
    throw new Error(`Docker host alias unexpectedly resolved to ${result.address}`);
  } catch (error) {
    if (error.message.startsWith('Docker host alias unexpectedly resolved')) throw error;
    if (['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(error.code)) {
      return error.code;
    }
    throw error;
  }
}

let interfaces = [];
let ipv4;
let ipv6;
try {
  await runCheck(
    'only-loopback-network-interface',
    'readdir /sys/class/net',
    async () => {
      interfaces = (await readdir('/sys/class/net')).sort();
      assert.deepEqual(interfaces, ['lo'], 'network=none container must expose only loopback');
      return { observedCode: interfaces.join(','), detail: 'network namespace exposes only the loopback interface' };
    }
  );

  await runCheck(
    'ipv4-loopback-fixture',
    'start fixture on 127.0.0.1:11434; TCP + HTTP GET 127.0.0.1:11434',
    async () => {
      ipv4 = await startFixture('127.0.0.1');
      const response = await requestLoopback('127.0.0.1');
      assert.match(response, /200 OK/);
      return { observedCode: 'HTTP_200', detail: 'IPv4 loopback fixture returned HTTP 200' };
    }
  );

  await runCheck(
    'ipv6-loopback-fixture',
    'start fixture on [::1]:11434; TCP + HTTP GET [::1]:11434',
    async () => {
      ipv6 = await startFixture('::1');
      const response = await requestLoopback('::1');
      assert.match(response, /200 OK/);
      return { observedCode: 'HTTP_200', detail: 'IPv6 loopback fixture returned HTTP 200' };
    }
  );

  await runCheck(
    'public-ip-egress-denied',
    'TCP connect 1.1.1.1:443',
    async () => {
      const code = await expectTcpBlocked('1.1.1.1', 443);
      return { observedCode: code, detail: 'direct public-IP connection denied by the network boundary' };
    }
  );

  await runCheck(
    'private-lan-egress-denied',
    'TCP connect 10.0.0.1:11434',
    async () => {
      const code = await expectTcpBlocked('10.0.0.1', 11434);
      return { observedCode: code, detail: 'private-LAN connection denied by the network boundary' };
    }
  );

  await runCheck(
    'public-dns-denied',
    'DNS A query example.com via 1.1.1.1:53',
    async () => {
      const code = await expectPublicDnsBlocked('example.com');
      return { observedCode: code, detail: 'direct public DNS query denied' };
    }
  );

  await runCheck(
    'docker-host-alias-denied',
    'system DNS lookup host.docker.internal',
    async () => {
      const code = await expectHostAliasUnavailable('host.docker.internal');
      return { observedCode: code, detail: 'Docker host alias is unavailable' };
    }
  );

  await runCheck(
    'policy-endpoint-allowlist',
    'URL allow/deny fixtures: two permitted loopback endpoints and ten rejected variants',
    async () => {
      const allowed = policy.allowedInferenceEndpoints;
      assert.deepEqual(allowed.map(item => [item.protocol, item.host, item.port]), [
        ['http', '127.0.0.1', 11434],
        ['http', '::1', 11434]
      ]);
      const endpointAllowed = endpoint => {
        try {
          const url = new URL(endpoint);
          const hostname = url.hostname.replace(/^\\[|\\]$/g, '').toLowerCase();
          return url.protocol === 'http:' &&
            (hostname === '127.0.0.1' || hostname === '::1') &&
            url.port === '11434' &&
            ['', '/', '/v1', '/v1/'].includes(url.pathname) &&
            !url.username && !url.password && !url.search && !url.hash;
        } catch {
          return false;
        }
      };
      const allowedEndpoints = ['http://127.0.0.1:11434/', 'http://[::1]:11434/v1'];
      const rejectedEndpoints = [
        'https://127.0.0.1:11434/',
        'http://localhost:11434/',
        'http://host.docker.internal:11434/',
        'http://ollama:11434/',
        'http://192.168.1.10:11434/',
        'http://127.0.0.1:11435/',
        'http://127.0.0.1:11434/v1/models',
        'http://user:pass@127.0.0.1:11434/',
        'http://127.0.0.1:11434/?token=not-allowed',
        'http://127.0.0.1:11434/#not-allowed'
      ];
      for (const endpoint of allowedEndpoints) {
        assert.equal(endpointAllowed(endpoint), true, `expected endpoint to be allowed: ${endpoint}`);
      }
      for (const endpoint of rejectedEndpoints) {
        assert.equal(endpointAllowed(endpoint), false, `expected endpoint to be rejected: ${endpoint}`);
      }
      return {
        observedCode: '2_ALLOWED_10_REJECTED',
        detail: 'only two explicit HTTP loopback endpoint forms were accepted; ten invalid variants were rejected'
      };
    }
  );

  await runCheck(
    'credential-environment-absent',
    'inspect process.env variable names and credential-shaped values; do not emit values',
    async () => {
      assert.deepEqual(forbiddenEnv, []);
      assert.deepEqual(unexpectedEnvNames, []);
      assert.deepEqual(suspiciousValues, []);
      return {
        observedCode: 'ENV_ALLOWLIST_MATCH',
        detail: 'only explicit Node image runtime variables are present; no credential-like values detected'
      };
    }
  );

  const probeVerdict = failedChecks === 0
    ? 'HARNESS_PASS_ONLY_NOT_GATE_PASS'
    : 'HARNESS_FAIL';
  console.log(JSON.stringify({
    schemaVersion: '1.0.0',
    evidenceType: 'isolated-container-network-boundary-test',
    modelInvocation: false,
    providerCalls: 0,
    providerSpendZar: 0,
    networkMode: 'none',
    networkInterfaces: interfaces,
    environmentVariableNames: Object.keys(process.env).sort(),
    allowedEnvironmentVariableNames: [...allowedContainerEnvNames].sort(),
    containerImageDigest: process.argv[2] ?? 'unknown',
    checks,
    failedChecks,
    verdict: probeVerdict,
    note: 'Only the two allowlisted harness files are mounted. This proves the disposable test container boundary only; it does not certify a production runner or Ollama deployment.'
  }, null, 2));
  if (failedChecks > 0) process.exitCode = 1;
} finally {
  if (ipv4) await new Promise(resolve => ipv4.close(resolve));
  if (ipv6) await new Promise(resolve => ipv6.close(resolve));
}
