import { describe, expect, it, vi } from 'vitest';
import { getAgentRunRetryDelayMs, invokeWithCancellationRetry, shouldRetryAgentRun } from './agentRunRetry.js';

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


describe('lease cancellation and provider retry boundary', () => {
  it('never starts a second provider attempt after an in-flight call is aborted', async () => {
    const controller = new AbortController();
    const calls: number[] = [];
    const pending = invokeWithCancellationRetry(async (attempt) => {
      calls.push(attempt);
      return new Promise<string>((_resolve, reject) => {
        const abort = () => reject(controller.signal.reason);
        if (controller.signal.aborted) abort();
        else controller.signal.addEventListener('abort', abort, { once: true });
      });
    }, controller.signal, 0);
    await Promise.resolve();
    controller.abort(new Error('worker lease lost'));
    await expect(pending).rejects.toThrow('worker lease lost');
    expect(calls).toEqual([0]);
  });

  it('does not invoke a provider when the lease is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort(new Error('lease already lost'));
    const invoke = vi.fn();
    await expect(invokeWithCancellationRetry(invoke, controller.signal)).rejects.toThrow('lease already lost');
    expect(invoke).not.toHaveBeenCalled();
  });
});
