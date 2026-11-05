import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

const gateContract = JSON.parse(await readFile('benchmarks/contracts/gate-contracts.json', 'utf8'));
const isolation = JSON.parse(await readFile('benchmarks/contracts/local-isolation-policy.json', 'utf8'));

if (gateContract.modelInvocation !== false || isolation.modelInvocation !== false) {
  throw new Error('Readiness contract must remain mock-only; model invocation is forbidden.');
}
if (gateContract.gates.length !== 6) throw new Error('Exactly six independent readiness gates are required.');

for (const gate of gateContract.gates) {
  if (!gate.id || !gate.name || !Array.isArray(gate.passEvidence) || gate.passEvidence.length === 0) {
    throw new Error('Gate ' + (gate.id ?? 'unknown') + ' has incomplete evidence requirements.');
  }
}

function assertLocalOllamaEndpoint(endpoint) {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  const allowedHost = host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (url.protocol !== 'http:' || !allowedHost || url.port !== '11434') {
    throw new Error('Strict local profile rejected a non-loopback Ollama endpoint.');
  }
  if (!['', '/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('Strict local profile rejected an unexpected Ollama path.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Strict local profile rejected credentials or URL modifiers.');
  }
}

for (const endpoint of ['http://127.0.0.1:11434','http://[::1]:11434/v1']) {
  assertLocalOllamaEndpoint(endpoint);
}

for (const blocked of ['http://host.docker.internal:11434','http://ollama:11434','https://api.example.invalid:443']) {
  let rejected = false;
  try { assertLocalOllamaEndpoint(blocked); } catch { rejected = true; }
  if (!rejected) throw new Error('Isolation policy incorrectly accepted ' + blocked);
}

const contractHash = createHash('sha256').update(JSON.stringify(gateContract)).digest('hex');
console.log(JSON.stringify({
  status:'PASS',
  modelInvocation:false,
  gates:gateContract.gates.map(({id,name,passEvidence})=>({id,name,evidenceContractPresent:passEvidence.length>0})),
  strictLoopbackPolicy:'PASS',
  gateContractSha256:contractHash
}, null, 2));
