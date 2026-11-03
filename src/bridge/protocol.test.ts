import { describe, expect, it } from 'vitest';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeProtocolError,
  parseBridgeClientEnvelope,
} from './protocol';

const envelope = (type: string, data: Record<string, unknown>) => ({
  version: BRIDGE_PROTOCOL_VERSION,
  id: 'frame-1',
  sentAt: 1_798_000_000_000,
  message: { type, data },
});

describe('RyanAI bridge protocol contract', () => {
  it('accepts a single-use connection ticket and resume cursor', () => {
    expect(
      parseBridgeClientEnvelope(
        envelope('hello', { ticket: 'single-use-ticket', resumeAfter: 'cursor-9' }),
      ).message.type,
    ).toBe('hello');
  });

  it('accepts heartbeat, subscription, acknowledgement, and idempotent publish frames', () => {
    expect(parseBridgeClientEnvelope(envelope('heartbeat', { nonce: 'n-1' })).message.type)
      .toBe('heartbeat');
    expect(parseBridgeClientEnvelope(envelope('subscribe', { topics: ['telemetry', 'tasks'] })).message.type)
      .toBe('subscribe');
    expect(parseBridgeClientEnvelope(envelope('ack', { eventId: 'event-1', cursor: 'cursor-1' })).message.type)
      .toBe('ack');
    expect(parseBridgeClientEnvelope(envelope('publish', {
      topic: 'tasks.requested',
      idempotencyKey: 'request-1',
      payload: { task: 'inspect' },
    })).message.type).toBe('publish');
  });

  it('rejects unsupported protocol versions without reflecting frame contents', () => {
    expect(() => parseBridgeClientEnvelope({ ...envelope('heartbeat', { nonce: 'n' }), version: 99 }))
      .toThrowError(BridgeProtocolError);
    try {
      parseBridgeClientEnvelope({ ...envelope('heartbeat', { nonce: 'n' }), version: 99 });
    } catch (error) {
      expect((error as Error).message).toBe('Invalid bridge protocol message');
      expect((error as Error).message).not.toContain('n');
    }
  });

  it.each([
    envelope('hello', { ticket: '' }),
    envelope('heartbeat', { nonce: '' }),
    envelope('subscribe', { topics: [] }),
    envelope('subscribe', { topics: Array.from({ length: 65 }, (_, i) => `topic-${i}`) }),
    envelope('ack', { eventId: 'event-1', cursor: '' }),
    envelope('publish', { topic: 'tasks.requested', idempotencyKey: '' }),
    envelope('unknown', {}),
    { ...envelope('heartbeat', { nonce: 'n' }), sentAt: Number.NaN },
  ])('rejects malformed client frame %j', (frame) => {
    expect(() => parseBridgeClientEnvelope(frame)).toThrowError(BridgeProtocolError);
  });
});
