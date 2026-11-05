import { describe, expect, it } from 'vitest';
import { normalizePersistedTraceContext } from './queueContext.js';

describe('durable queue trace context privacy contract', () => {
  it('keeps valid W3C trace context and drops unrelated fields', () => {
    expect(normalizePersistedTraceContext({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      tracestate: 'vendor=value',
      baggage: 'user.email=private@example.com',
      prompt: 'private prompt',
    })).toEqual({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      tracestate: 'vendor=value',
    });
  });

  it('rejects malformed or all-zero identifiers and oversized state', () => {
    expect(normalizePersistedTraceContext({
      traceparent: 'not-a-trace-id',
      tracestate: 'x'.repeat(513),
    })).toBeNull();
    expect(normalizePersistedTraceContext({
      traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
    })).toBeNull();
    expect(normalizePersistedTraceContext({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
    })).toBeNull();
  });

  it('does not persist baggage-only or arbitrary data', () => {
    expect(normalizePersistedTraceContext({
      baggage: 'authorization=secret',
      authorization: 'Bearer secret',
      prompt: 'sensitive input',
    })).toBeNull();
    expect(normalizePersistedTraceContext(null)).toBeNull();
  });
});
