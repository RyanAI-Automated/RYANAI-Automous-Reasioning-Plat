import { describe, expect, it } from 'vitest';
import { getAgentRunRetryDelayMs, shouldRetryAgentRun } from './agentRunRetry.js';

describe('durable agent run retry policy', () => {
  it('retries only while claimed attempts remain below the configured maximum', () => {
    expect(shouldRetryAgentRun(1, 3)).toBe(true);
    expect(shouldRetryAgentRun(2, 3)).toBe(true);
    expect(shouldRetryAgentRun(3, 3)).toBe(false);
    expect(shouldRetryAgentRun(4, 3)).toBe(false);
  });

  it('rejects invalid attempt counters rather than creating an unbounded retry loop', () => {
    expect(shouldRetryAgentRun(0, 3)).toBe(false);
    expect(shouldRetryAgentRun(-1, 3)).toBe(false);
    expect(shouldRetryAgentRun(1.5, 3)).toBe(false);
    expect(shouldRetryAgentRun(1, 0)).toBe(false);
  });

  it('uses capped exponential backoff', () => {
    expect(getAgentRunRetryDelayMs(1)).toBe(5_000);
    expect(getAgentRunRetryDelayMs(2)).toBe(10_000);
    expect(getAgentRunRetryDelayMs(3)).toBe(20_000);
    expect(getAgentRunRetryDelayMs(5)).toBe(60_000);
    expect(getAgentRunRetryDelayMs(20)).toBe(60_000);
  });
});
