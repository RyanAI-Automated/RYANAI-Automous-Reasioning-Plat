export const DEFAULT_STREAM_MAX_LENGTH = 10000;
export const EVENT_DEDUPE_TTL_SECONDS = 86400;

export function userStreamKey(userId) {
  return 'ryanai:connectivity:events:' + Buffer.from(userId).toString('base64url');
}
export function userCursorKey(userId) {
  return 'ryanai:connectivity:cursor:' + Buffer.from(userId).toString('base64url');
}
export function compareStreamIds(left, right) {
  const a = String(left).split('-').map(BigInt);
  const b = String(right).split('-').map(BigInt);
  if (a.length !== 2 || b.length !== 2) throw new Error('Invalid Redis stream ID');
  return a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1);
}
export function canAcknowledgeNext(deliveredIds, requestedId) {
  return Array.isArray(deliveredIds) && deliveredIds.length > 0 && deliveredIds[0] === requestedId;
}

/** Atomically deduplicates and appends an event to the user's durable Redis Stream. */
export async function publishUserEvent(redis, { userId, idempotencyKey, payload, maxLength = DEFAULT_STREAM_MAX_LENGTH }) {
  if (typeof userId !== 'string' || !userId || userId.length > 256) throw new Error('Invalid user identity');
  if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(idempotencyKey)) throw new Error('Invalid idempotency key');
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error('Invalid event payload');
  if (Buffer.byteLength(serialized) > 256 * 1024) throw new Error('Event payload is too large');
  const dedupeKey = 'ryanai:connectivity:dedupe:' + Buffer.from(userId).toString('base64url') + ':' + Buffer.from(idempotencyKey).toString('base64url');
  const script = [
    "if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('GET', KEYS[1]) end",
    "local id = redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[3], '*', 'eventId', ARGV[1], 'payload', ARGV[2], 'occurredAt', ARGV[4])",
    "redis.call('SET', KEYS[1], id, 'EX', ARGV[5])",
    "return id"
  ].join('\n');
  return await redis.eval(script, {
    keys: [dedupeKey, userStreamKey(userId)],
    arguments: [idempotencyKey, serialized, String(maxLength), String(Date.now()), String(EVENT_DEDUPE_TTL_SECONDS)],
  });
}
