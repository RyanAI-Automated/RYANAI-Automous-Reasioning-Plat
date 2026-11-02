import { beforeEach, describe, expect, it, vi } from 'vitest';

const brains = vi.hoisted(() => ({
  primary: { invoke: vi.fn() },
  secondary: { invoke: vi.fn() },
  logic: { invoke: vi.fn() },
}));
vi.mock('../config/brains', () => ({
  primaryBrain: brains.primary,
  secondaryBrain: brains.secondary,
  logicBrain: brains.logic,
}));

import { RyanAIDispatcher } from './dispatcher';

beforeEach(() => {
  vi.clearAllMocks();
  brains.logic.invoke.mockResolvedValue({
    content: JSON.stringify([
      { id: 'task-1', title: 'Threat review', targetBrain: 'qwen', payload: 'Review security controls.' },
      { id: 'task-2', title: 'Architecture review', targetBrain: 'nvidia', payload: 'Review service boundaries.' },
    ]),
  });
  brains.primary.invoke.mockResolvedValue({ content: 'Primary result' });
  brains.secondary.invoke.mockResolvedValue({ content: 'Secondary result' });
});

describe('RyanAI dispatcher', () => {
  it('plans work without executing any specialist task', async () => {
    const result = await RyanAIDispatcher.planObjective('Review the platform');
    expect(result.tasks).toHaveLength(2);
    expect(brains.logic.invoke).toHaveBeenCalledOnce();
    expect(brains.primary.invoke).not.toHaveBeenCalled();
    expect(brains.secondary.invoke).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON rather than silently executing a fallback task', async () => {
    brains.logic.invoke.mockResolvedValue({ content: 'not json' });
    await expect(RyanAIDispatcher.planObjective('Review')).rejects.toThrow('invalid task-plan JSON');
    expect(brains.primary.invoke).not.toHaveBeenCalled();
    expect(brains.secondary.invoke).not.toHaveBeenCalled();
  });

  it('rejects invalid or over-sized task plans before execution', async () => {
    brains.logic.invoke.mockResolvedValue({
      content: JSON.stringify([{ id: 'x', title: 'Run command', targetBrain: 'shell', payload: 'rm -rf /' }]),
    });
    await expect(RyanAIDispatcher.planObjective('Review')).rejects.toThrow('invalid id, title, payload, or brain');
  });

  it('rejects forged or corrupted plans at execution time before calling any brain', async () => {
    await expect(RyanAIDispatcher.executeTasks([
      { id: 'task-1', title: 'Run an invalid brain', targetBrain: 'shell' as never, payload: 'Do something' },
    ])).rejects.toThrow('invalid id, title, payload, or brain');
    await expect(RyanAIDispatcher.executeTasks([
      { id: 'task-1', title: 'First', targetBrain: 'nvidia', payload: 'Analyze.' },
      { id: 'task-1', title: 'Duplicate', targetBrain: 'qwen', payload: 'Analyze.' },
    ])).rejects.toThrow('duplicate task identifiers');
    await expect(RyanAIDispatcher.executeTasks([
      { id: '../unsafe', title: 'Traversal-like identifier', targetBrain: 'logic', payload: 'Analyze.' },
    ])).rejects.toThrow('invalid identifier');
    expect(brains.primary.invoke).not.toHaveBeenCalled();
    expect(brains.secondary.invoke).not.toHaveBeenCalled();
    expect(brains.logic.invoke).not.toHaveBeenCalled();
  });

  it('executes only validated tasks and returns traceable outputs', async () => {
    const plan = await RyanAIDispatcher.planObjective('Review the platform');
    const results = await RyanAIDispatcher.executeTasks(plan.tasks);
    expect(brains.secondary.invoke).toHaveBeenCalledOnce();
    expect(brains.primary.invoke).toHaveBeenCalledOnce();
    expect(results.map((item) => item.id)).toEqual(['task-1', 'task-2']);
    expect(results[0].output).toBe('Secondary result');
    expect(results[1].output).toBe('Primary result');
  });
});
