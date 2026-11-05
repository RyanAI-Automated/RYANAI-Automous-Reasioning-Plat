import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve4 } from 'node:dns/promises';
import net from 'node:net';
import { readFile } from 'node:fs/promises';

const policy = JSON.parse(await readFile('benchmarks/contracts/local-isolation-policy.json', 'utf8'));
assert.equal(policy.modelInvocation, false, 'isolation harness must never invoke a model');
assert.equal(policy.failClosed, true);
assert.equal(policy.cloudFallback, false);

const forbiddenEnv = Object.keys(process.env).filter(name =>
  /(API_KEY|ACCESS_TOKEN|DATABASE_URL|DEPLOY_TOKEN|SECRET|CREDENTIAL)/i.test(name)
);
assert.deepEqual(forbiddenEnv, [], 'credentials or production connection variables must not enter the container');

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

async function expectTcpBlocked(host, port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1200);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`Unexpected network connection to ${host}:${port}`));
    });
    socket.once('error', error => {
      if (['ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code)) resolve();
      else reject(error);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve();
    });
  });
}

async function expectDnsBlocked(hostname) {
  try {
    await Promise.race([
      resolve4(hostname),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS probe timed out')), 1500))
    ]);
    throw new Error(`Unexpected DNS resolution for ${hostname}`);
  } catch (error) {
    if (error.message.startsWith('Unexpected DNS resolution')) throw error;
    if (error.code && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEOUT'].includes(error.code)) return;
    if (error.message === 'DNS probe timed out') return;
    throw error;
  }
}

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

  await expectTcpBlocked('1.1.1.1', 443);
  record('public-ip-egress-denied', 'direct TCP connection to public IP blocked');

  await expectTcpBlocked('10.0.0.1', 11434);
  record('private-lan-egress-denied', 'direct TCP connection to private network address blocked');

  await expectDnsBlocked('example.com');
  record('public-dns-denied', 'public hostname resolution unavailable');

  await expectDnsBlocked('host.docker.internal');
  record('docker-host-alias-denied', 'host.docker.internal cannot be resolved');

  const allowed = policy.allowedInferenceEndpoints;
  assert.deepEqual(allowed.map(item => [item.protocol, item.host, item.port]), [
    ['http', '127.0.0.1', 11434],
    ['http', '::1', 11434]
  ]);
  record('policy-endpoint-allowlist', 'only HTTP loopback endpoints on port 11434 are permitted');

  const forbiddenCapabilities = forbiddenEnv.length === 0;
  assert.equal(forbiddenCapabilities, true);
  record('credential-environment-absent', 'no provider credentials or production connection variables present');

  console.log(JSON.stringify({
    schemaVersion: '1.0.0',
    evidenceType: 'isolated-container-network-boundary-test',
    modelInvocation: false,
    providerCalls: 0,
    providerSpendZar: 0,
    networkMode: 'none',
    containerImageDigest: process.argv[2] ?? 'unknown',
    checks,
    verdict: 'HARNESS_PASS_ONLY_NOT_GATE_PASS',
    note: 'This proves the test container boundary only; it does not prove a production runner or Ollama deployment is isolated.'
  }, null, 2));
} finally {
  await new Promise(resolve => ipv4.close(resolve));
  if (ipv6) await new Promise(resolve => ipv6.close(resolve));
}
