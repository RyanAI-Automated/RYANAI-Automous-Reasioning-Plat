import { describe, expect, it } from 'vitest';
import { safeTelemetryAttributes, withTelemetrySpan } from './core.js';

describe('telemetry privacy contract', () => {
  it('keeps only bounded allowlisted metadata', () => {
    expect(safeTelemetryAttributes({
      'agent.operation': 'reasoning', 'agent.tool': 'system_diagnostics',
      'agent.policy_outcome': 'ALLOW', prompt: 'private prompt',
      'tool.arguments': 'private arguments', authorization: 'Bearer secret',
      'agent.brain': 'x'.repeat(81), 'agent.retry_count': Number.POSITIVE_INFINITY,
    })).toEqual({
      'agent.operation': 'reasoning', 'agent.tool': 'system_diagnostics',
      'agent.policy_outcome': 'ALLOW',
    });
  });
  it('runs without requiring an exporter', async () => {
    await expect(withTelemetrySpan('agent.test', { 'agent.operation': 'test' }, async () => 'ok')).resolves.toBe('ok');
  });
  it('does not attach exception messages to telemetry', async () => {
    await expect(withTelemetrySpan('agent.test', { 'agent.operation': 'test' }, async () => {
      throw new Error('sensitive prompt or token must not be recorded');
    })).rejects.toThrow('sensitive prompt or token must not be recorded');
  });
});
