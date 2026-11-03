import test from 'node:test';
import assert from 'node:assert/strict';
import { canAcknowledgeNext, compareStreamIds, publishUserEvent, userStreamKey } from './stream-store.mjs';

test('Redis stream IDs compare numerically, not lexicographically', () => {
  assert.equal(compareStreamIds('10-0', '9-99'), 1);
  assert.equal(compareStreamIds('10-1', '10-2'), -1);
  assert.equal(compareStreamIds('10-2', '10-2'), 0);
});
test('acknowledgements must follow delivery order', () => {
  assert.equal(canAcknowledgeNext(['1-0', '2-0'], '1-0'), true);
  assert.equal(canAcknowledgeNext(['1-0', '2-0'], '2-0'), false);
  assert.equal(canAcknowledgeNext([], '1-0'), false);
});
test('event append is idempotent and survives a transient Redis failure', async () => {
  const entries = new Map();
  const redis = {
    calls: 0,
    async eval(_script, options) {
      this.calls += 1;
      if (this.calls === 1) throw new Error('injected Redis interruption');
      const [dedupe, stream] = options.keys;
      if (entries.has(dedupe)) return entries.get(dedupe);
      const id = '1000-' + this.calls;
      entries.set(dedupe, id);
      entries.set(stream, { id, payload: options.arguments[1] });
      return id;
    },
  };
  const input = { userId: 'user-1', idempotencyKey: 'event-1', payload: { value: 42 } };
  await assert.rejects(publishUserEvent(redis, input), /injected Redis interruption/);
  const first = await publishUserEvent(redis, input);
  const second = await publishUserEvent(redis, input);
  assert.equal(first, second);
  assert.equal(entries.get(userStreamKey('user-1')).payload, JSON.stringify({ value: 42 }));
});
test('publishing rejects unsafe identities, idempotency keys and oversized payloads', async () => {
  const redis = { eval: async () => '1-0' };
  await assert.rejects(publishUserEvent(redis, { userId: '', idempotencyKey: 'x', payload: {} }));
  await assert.rejects(publishUserEvent(redis, { userId: 'user', idempotencyKey: '../x', payload: {} }));
  await assert.rejects(publishUserEvent(redis, { userId: 'user', idempotencyKey: 'x', payload: 'x'.repeat(300000) }));
  await assert.rejects(publishUserEvent(redis, { userId: 'user', idempotencyKey: 'x', payload: undefined }), /Invalid event payload/);
});
