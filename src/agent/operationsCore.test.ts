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
  it('fails visibly when a specialist fails', async () => {
    await expect(executeThreeBrainPlan('test', async (brain) => {
      if (brain === 'secondary') throw new Error('provider unavailable');
      return { brain, output: 'ok', latencyMs: 1 };
    })).rejects.toThrow('provider unavailable');
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