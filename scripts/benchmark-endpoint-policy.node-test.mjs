import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedInferenceEndpoint } from './benchmark-endpoint-policy.mjs';

const policy = [
  { protocol: 'http', host: '127.0.0.1', port: 11434, pathPrefixes: ['/', '/v1'] },
  { protocol: 'http', host: '::1', port: 11434, pathPrefixes: ['/', '/v1'] }
];

test('allows IPv4 and bracketed IPv6 loopback paths declared in policy', () => {
  assert.equal(isAllowedInferenceEndpoint('http://127.0.0.1:11434/', policy), true);
  assert.equal(isAllowedInferenceEndpoint('http://[::1]:11434/v1', policy), true);
  assert.equal(isAllowedInferenceEndpoint('http://[::1]:11434/v1/', policy), true);
});

test('rejects non-loopback, alternate protocols, ports, paths and URL credentials', () => {
  for (const endpoint of [
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
  ]) {
    assert.equal(isAllowedInferenceEndpoint(endpoint, policy), false, endpoint);
  }
});
