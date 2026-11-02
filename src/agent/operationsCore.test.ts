import { describe, expect, it } from 'vitest';
import { executeThreeBrainPlan, verifyThreeBrainResult, type BrainId } from './operationsCore.js';

describe('executeThreeBrainPlan', () => {
  it('runs primary and secondary in parallel before logic synthesis', async () => {
    const calls: Array<{ brain: BrainId; prompt: string }> = [];
    const result = await executeThreeBrainPlan('Plan a safe rollout', async (brain, prompt) => {
      calls.push({ brain, prompt });
      return { brain, output: brain + ' result', latencyMs: 2 };
    });
    expect(calls.slice(0, 2).map((x) => x.brain).sort()).toEqual(['primary', 'secondary']);
    expect(calls[2].brain).toBe('logic');
    expect(calls[2].prompt).toContain('primary result');
    expect(calls[2].prompt).toContain('secondary result');
    expect(result.outputs).toHaveLength(3);
    expect(result.handoffs).toHaveLength(4);
    expect(result.verification.verified).toBe(true);
  });
  it('aborts both in-flight specialist calls on lease loss and never starts synthesis', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const calls: BrainId[] = [];
    let resolveStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const pending = executeThreeBrainPlan('test lease cancellation', (brain, _prompt, signal) => {
      calls.push(brain);
      if (signal) signals.push(signal);
      if (calls.length === 2) resolveStarted();
      return new Promise<{ brain: BrainId; output: string; latencyMs: number }>((_, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }, controller.signal);
    await bothStarted;
    controller.abort(new Error('worker lease lost'));
    await expect(pending).rejects.toThrow('worker lease lost');
    expect(calls.sort()).toEqual(['primary', 'secondary']);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal === controller.signal && signal.aborted)).toBe(true);
    expect(calls).not.toContain('logic');
  });
  it('continues in explicitly degraded mode when a specialist fails', async () => {
    const result = await executeThreeBrainPlan('test', async (brain) => {
      if (brain === 'secondary') throw new Error('provider unavailable');
      return { brain, output: 'ok', latencyMs: 1 };
    });
    expect(result.degraded).toBe(true);
    expect(result.verification.verified).toBe(false);
    expect(result.outputs.map((item) => item.brain)).toEqual(['primary', 'logic']);
  });
});

describe('verifyThreeBrainResult', () => {
  const complete = [
    { brain: 'primary' as const, output: 'analysis A', latencyMs: 10 },
    { brain: 'secondary' as const, output: 'analysis B', latencyMs: 12 },
    { brain: 'logic' as const, output: 'synthesis', latencyMs: 8 },
  ];
  it('accepts exactly three non-empty brain results and a synthesis', () => {
    expect(verifyThreeBrainResult(complete, 'synthesis')).toEqual({ verified: true, reason: null });
  });
  it('rejects missing, duplicate, empty or absent synthesis results', () => {
    expect(verifyThreeBrainResult(complete.slice(0, 2), 'synthesis').verified).toBe(false);
    expect(verifyThreeBrainResult([complete[0], complete[0], complete[2]], 'synthesis').verified).toBe(false);
    expect(verifyThreeBrainResult(complete.map((item, index) => index === 1 ? { ...item, output: ' ' } : item), 'synthesis').verified).toBe(false);
    expect(verifyThreeBrainResult(complete, ' ').verified).toBe(false);
  });
});

describe('degraded brain execution policy', () => {
  it('returns labelled degraded output when one specialist rejects authentication', async () => {
    const result = await executeThreeBrainPlan('Recover safely', async (brain) => {
      if (brain === 'secondary') throw new Error('Provider authentication or authorization failed (HTTP 401).');
      return { brain, output: brain + ' verified analysis', latencyMs: 4 };
    });
    expect(result.degraded).toBe(true);
    expect(result.verification.verified).toBe(false);
    expect(result.outputs.map((item) => item.brain)).toEqual(['primary', 'logic']);
    expect(result.synthesis).toContain('logic');
    expect(result.failures[0].reason).toContain('HTTP 401');
    expect(result.handoffs).toHaveLength(2);
  });

  it('attempts all three brains and fails clearly when primary times out and the other two reject authentication', async () => {
    const calls: BrainId[] = [];
    await expect(executeThreeBrainPlan('Recover safely', async (brain) => {
      calls.push(brain);
      if (brain === 'primary') throw new Error('Provider request timed out.');
      throw new Error('Provider authentication or authorization failed (HTTP 401).');
    })).rejects.toThrow(/All reasoning brains are unavailable.*primary: Provider request timed out.*secondary: Provider authentication.*logic: Provider authentication/);
    expect(calls.sort()).toEqual(['logic', 'primary', 'secondary']);
  });

  it('uses a labelled standalone Logic fallback when both specialists fail', async () => {
    const result = await executeThreeBrainPlan('Recover safely', async (brain) => {
      if (brain !== 'logic') throw new Error('Provider unavailable');
      return { brain, output: 'Independent logic response', latencyMs: 4 };
    });
    expect(result.degraded).toBe(true);
    expect(result.synthesis).toContain('standalone Logic response');
    expect(result.synthesis).toContain('Independent logic response');
  });
});
