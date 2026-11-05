import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'agent.operation', 'agent.brain', 'agent.tool', 'agent.outcome',
  'agent.policy_outcome', 'agent.error_type', 'agent.retry_count',
]);

/** Allowlisted, bounded metadata only. Unknown keys and content-like values are dropped. */
export function safeTelemetryAttributes(input: Record<string, unknown> = {}): Attributes {
  const safe: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_ATTRIBUTE_KEYS.has(key)) continue;
    if (typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === 'string' && value.length > 0 && value.length <= 80) safe[key] = value;
  }
  return safe;
}

/** Run work inside a span without recording prompts, arguments, results, or exception messages. */
export function withTelemetrySpan<T>(name: string, attributes: Record<string, unknown>, operation: (span: Span) => Promise<T>): Promise<T> {
  return trace.getTracer('ryanai.agent').startActiveSpan(name, { attributes: safeTelemetryAttributes(attributes) }, async (span) => {
    try { return await operation(span); }
    catch (error) { span.setStatus({ code: SpanStatusCode.ERROR }); throw error; }
    finally { span.end(); }
  });
}
