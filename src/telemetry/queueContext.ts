import { context, propagation, ROOT_CONTEXT, type Context } from '@opentelemetry/api';

export interface PersistedTraceContext {
  traceparent?: string;
  tracestate?: string;
}

const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

/** Persist only bounded W3C trace context. Baggage and arbitrary carrier fields are excluded. */
export function normalizePersistedTraceContext(value: unknown): PersistedTraceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const traceparent = typeof input.traceparent === 'string' && TRACEPARENT_PATTERN.test(input.traceparent)
    ? input.traceparent
    : undefined;
  const tracestate = typeof input.tracestate === 'string'
    && input.tracestate.length <= 512
    && /^[\x20-\x7e]*$/.test(input.tracestate)
    ? input.tracestate
    : undefined;
  return traceparent || tracestate
    ? { ...(traceparent ? { traceparent } : {}), ...(tracestate ? { tracestate } : {}) }
    : null;
}

/** Capture active trace context for a durable job; never persist baggage. */
export function captureQueueTraceContext(): PersistedTraceContext | null {
  const carrier: PersistedTraceContext = {};
  propagation.inject(context.active(), carrier, {
    set(target, key, value) {
      if ((key === 'traceparent' || key === 'tracestate') && typeof value === 'string') target[key] = value;
    },
  });
  return normalizePersistedTraceContext(carrier);
}

/** Restore the originating context before the worker creates child spans. */
export function runWithQueueTraceContext<T>(value: unknown, operation: (activeContext: Context) => T): T {
  const carrier = normalizePersistedTraceContext(value) ?? {};
  const extracted = propagation.extract(ROOT_CONTEXT, carrier, {
    get(target, key) {
      return key === 'traceparent' || key === 'tracestate' ? target[key as keyof PersistedTraceContext] : undefined;
    },
    keys(target) { return Object.keys(target); },
  });
  return context.with(extracted, () => operation(extracted));
}
