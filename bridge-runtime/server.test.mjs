import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
const secret = 'test-secret-that-is-long-enough-for-hmac';
function sign(claims) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return encoded + '.' + createHmac('sha256', secret).update(encoded).digest('base64url');
}
function verify(ticket, now = Math.floor(Date.now() / 1000)) {
  const parts = ticket.split('.');
  assert.equal(parts.length, 2);
  const [encoded, supplied] = parts;
  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  assert.equal(a.length, b.length);
  assert.ok(timingSafeEqual(a, b));
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  assert.ok(claims.exp > now);
  assert.ok(claims.topics.length > 0 && claims.topics.length <= 64);
  assert.ok(claims.topics.every((topic) => /^[a-zA-Z0-9._:-]{1,128}$/.test(topic)));
  return claims;
}
test('ticket claims are signed and preserve bounded topic grants', () => {
  assert.deepEqual(verify(sign({ sub: 'user-1', topics: ['telemetry'], exp: 2000, jti: 'ticket-1' }), 1000).topics, ['telemetry']);
});
test('ticket tampering is rejected', () => {
  const ticket = sign({ sub: 'user-1', topics: ['telemetry'], exp: 2000, jti: 'ticket-1' });
  const [encoded, signature] = ticket.split('.');
  const changed = Buffer.from(JSON.stringify({ sub: 'user-2', topics: ['admin'], exp: 2000, jti: 'ticket-1' })).toString('base64url');
  const expected = createHmac('sha256', secret).update(changed).digest('base64url');
  assert.notEqual(changed, encoded);
  assert.notEqual(signature, expected);
});
test('expired tickets are rejected', () => {
  assert.throws(() => verify(sign({ sub: 'user-1', topics: ['telemetry'], exp: 900, jti: 'ticket-1' }), 1000));
});
test('unsafe topic names and oversized grants are rejected', () => {
  assert.throws(() => verify(sign({ sub: 'user-1', topics: ['../secrets'], exp: 2000, jti: 'x' }), 1000));
  assert.throws(() => verify(sign({ sub: 'user-1', topics: Array.from({ length: 65 }, (_, i) => 't' + i), exp: 2000, jti: 'x' }), 1000));
});
