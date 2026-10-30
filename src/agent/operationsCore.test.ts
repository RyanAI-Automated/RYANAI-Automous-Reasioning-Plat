import { describe, expect, it } from 'vitest';
import { executeThreeBrainPlan, type BrainId } from './operationsCore.js';
describe('executeThreeBrainPlan', () => {
  it('runs primary and secondary in parallel before logic synthesis', async () => {
    const calls: Array<{ brain: BrainId; prompt: string }> = [];
    const result = await executeThreeBrainPlan('Plan a safe rollout', async (brain, prompt) => {
      calls.push({ brain, prompt }); return { brain, output: `${brain} result`, latencyMs: 2 };
    });
    expect(calls.slice(0, 2).map((x) => x.brain).sort()).toEqual(['primary', 'secondary']);
    expect(calls[2].brain).toBe('logic');
    expect(calls[2].prompt).toContain('primary result');
    expect(calls[2].prompt).toContain('secondary result');
    expect(result.outputs).toHaveLength(3);
    expect(result.handoffs).toHaveLength(4);
  });
  it('fails visibly when a specialist fails', async () => {
    await expect(executeThreeBrainPlan('test', async (brain) => {
      if (brain === 'secondary') throw new Error('provider unavailable');
      return { brain, output: 'ok', latencyMs: 1 };
    })).rejects.toThrow('provider unavailable');
  });
});
