import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { context, trace, type SpanContext } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  captureQueueTraceContext,
  normalizePersistedTraceContext,
  runWithQueueTraceContext,
} from './queueContext.js';

const sdk = new NodeSDK({});
const parentSpanContext: SpanContext = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  traceFlags: 1,
  isRemote: false,
};

beforeAll(() => {
  sdk.start();
});

afterAll(async () => {
  await sdk.shutdown();
});

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

  it('serializes the active parent and restores it as the worker active context', () => {
    const parentContext = trace.setSpanContext(context.active(), parentSpanContext);

    const serialized = context.with(parentContext, () => captureQueueTraceContext());

    expect(serialized).toEqual({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });

    const restored = runWithQueueTraceContext(serialized, (activeContext) => ({
      active: trace.getSpanContext(context.active()),
      supplied: trace.getSpanContext(activeContext),
    }));

    expect(restored.active).toMatchObject(parentSpanContext);
    expect(restored.supplied).toMatchObject(parentSpanContext);
    expect(trace.getSpanContext(context.active())).toBeUndefined();
  });

  it('runs without inventing a parent when persisted context is invalid', () => {
    const result = runWithQueueTraceContext({ traceparent: 'invalid' }, (activeContext) => ({
      active: trace.getSpanContext(context.active()),
      supplied: trace.getSpanContext(activeContext),
    }));

    expect(result).toEqual({ active: undefined, supplied: undefined });
  });
});
