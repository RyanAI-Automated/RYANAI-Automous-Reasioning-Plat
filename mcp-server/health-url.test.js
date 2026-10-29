import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHealthUrl } from './health-url.js';

const configured = 'https://api.example.test/health';

test('uses the configured health endpoint by default', () => {
  assert.equal(resolveHealthUrl(undefined, configured).href, configured);
});

test('allows an explicit URL only when it matches the configured origin and path', () => {
  assert.equal(resolveHealthUrl('https://api.example.test/health', configured).href, configured);
});

test('rejects arbitrary hosts, cloud metadata targets, and alternate ports', () => {
  for (const url of [
    'https://attacker.example/health',
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/admin',
    'https://api.example.test:444/health',
  ]) {
    assert.throws(() => resolveHealthUrl(url, configured), /must match the configured API health endpoint/);
  }
});

test('rejects path changes and URL credentials, query strings, and fragments', () => {
  assert.throws(
    () => resolveHealthUrl('https://api.example.test/admin', configured),
    /must match the configured API health endpoint/,
  );
  assert.throws(
    () => resolveHealthUrl('https://user:password@api.example.test/health', configured),
    /without credentials/,
  );
  assert.throws(
    () => resolveHealthUrl('https://api.example.test/health?token=x', configured),
    /without credentials/,
  );
  assert.throws(
    () => resolveHealthUrl('https://api.example.test/health#fragment', configured),
    /without credentials/,
  );
});

test('rejects an invalid configured health endpoint', () => {
  assert.throws(() => resolveHealthUrl(undefined, 'file:///etc/passwd'), /HTTP\(S\) URL/);
});
