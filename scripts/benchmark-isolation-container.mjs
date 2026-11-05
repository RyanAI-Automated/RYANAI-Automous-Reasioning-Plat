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
assert.deepEqual(suspiciousValues, [], 'credential-shaped values must not enter the container');

const checks = [];
const record = (name, detail) => checks.push({ name, status: 'PASS', detail });

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

const interfaces = (await readdir('/sys/class/net')).sort();
assert.deepEqual(interfaces, ['lo'], 'network=none container must expose only loopback');
record('only-loopback-network-interface', 'network namespace exposes no external interface');

const ipv4 = await startFixture('127.0.0.1');
let ipv6;
try {
  const response4 = await requestLoopback('127.0.0.1');
  assert.match(response4, /200 OK/);
  record('ipv4-loopback-fixture', '127.0.0.1:11434 reachable inside isolated namespace');

  ipv6 = await startFixture('::1');
  const response6 = await requestLoopback('::1');
  assert.match(response6, /200 OK/);
  record('ipv6-loopback-fixture', '[::1]:11434 reachable inside isolated namespace');

  const publicCode = await expectTcpBlocked('1.1.1.1', 443);
  record('public-ip-egress-denied', `direct TCP connection blocked by network boundary (${publicCode})`);

  const privateCode = await expectTcpBlocked('10.0.0.1', 11434);
  record('private-lan-egress-denied', `direct TCP connection blocked by network boundary (${privateCode})`);

  const dnsCode = await expectPublicDnsBlocked('example.com');
  record('public-dns-denied', `direct query to public resolver blocked (${dnsCode})`);

  const aliasCode = await expectHostAliasUnavailable('host.docker.internal');
  record('docker-host-alias-denied', `host.docker.internal is unavailable (${aliasCode})`);

  const allowed = policy.allowedInferenceEndpoints;
  assert.deepEqual(allowed.map(item => [item.protocol, item.host, item.port]), [
    ['http', '127.0.0.1', 11434],
    ['http', '::1', 11434]
  ]);
  record('policy-endpoint-allowlist', 'only HTTP loopback endpoints on port 11434 are declared');

  assert.deepEqual(forbiddenEnv, []);
  assert.deepEqual(suspiciousValues, []);
  record('credential-environment-absent', 'no credential-like variables or values are present');

  console.log(JSON.stringify({
    schemaVersion: '1.0.0',
    evidenceType: 'isolated-container-network-boundary-test',
    modelInvocation: false,
    providerCalls: 0,
    providerSpendZar: 0,
    networkMode: 'none',
    networkInterfaces: interfaces,
    containerImageDigest: process.argv[2] ?? 'unknown',
    checks,
    verdict: 'HARNESS_PASS_ONLY_NOT_GATE_PASS',
    note: 'Only the two allowlisted harness files are mounted. This proves the disposable test container boundary only; it does not certify a production runner or Ollama deployment.'
  }, null, 2));
} finally {
  await new Promise(resolve => ipv4.close(resolve));
  if (ipv6) await new Promise(resolve => ipv6.close(resolve));
}
