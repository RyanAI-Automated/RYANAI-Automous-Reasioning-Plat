import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  buildMemoryContext: vi.fn(),
  claimDueTasks: vi.fn(),
  finishTask: vi.fn(),
}));

vi.mock('../agent/scheduledAgent.js', () => ({
  getScheduledAgent: () => ({ invoke: state.invoke }),
}));
vi.mock('../agent/memoryContext.js', () => ({ buildMemoryContext: state.buildMemoryContext }));
vi.mock('./taskStore.js', () => ({
  claimDueTasks: state.claimDueTasks,
  finishTask: state.finishTask,
}));

import { runDueTasks, runScheduledTask, startScheduler } from './runner.js';

const task = { id: 't1', userId: 'user-1', prompt: 'Do the thing', intervalMinutes: null };

beforeEach(() => {
  vi.clearAllMocks();
  state.buildMemoryContext.mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runScheduledTask', () => {
  it('runs the prompt as the user, with a time limit, and returns the last message', async () => {
    state.invoke.mockResolvedValue({ messages: [{ content: 'first' }, { content: 'the result' }] });
    const outcome = await runScheduledTask(task);
    expect(outcome).toEqual({ result: 'the result' });
    const [input, config] = state.invoke.mock.calls[0];
    expect(input.messages).toEqual([{ role: 'user', content: 'Do the thing' }]);
    expect(config.configurable).toEqual({ userId: 'user-1', role: 'user' });
    expect(config.signal).toBeInstanceOf(AbortSignal);
    expect(config.recursionLimit).toBe(15);
  });

  it('adds the saved notes of the user first', async () => {
    state.buildMemoryContext.mockResolvedValue('Saved notes about the user. data');
    state.invoke.mockResolvedValue({ messages: [{ content: 'ok' }] });
    await runScheduledTask(task);
    expect(state.buildMemoryContext).toHaveBeenCalledWith('user-1');
    expect(state.invoke.mock.calls[0][0].messages[0]).toEqual({
      role: 'system',
      content: 'Saved notes about the user. data',
    });
  });

  it('cuts a very long result', async () => {
    state.invoke.mockResolvedValue({ messages: [{ content: 'z'.repeat(20_000) }] });
    const outcome = await runScheduledTask(task);
    expect(outcome.result).toHaveLength(8000);
  });

  it('turns a failure into an outcome and does not throw', async () => {
    state.invoke.mockRejectedValue(new Error('provider down'));
    expect(await runScheduledTask(task)).toEqual({ error: 'provider down' });
  });
});

describe('runDueTasks', () => {
  it('runs every claimed task and records each outcome', async () => {
    const second = { ...task, id: 't2' };
    state.claimDueTasks.mockResolvedValue([task, second]);
    state.invoke
      .mockResolvedValueOnce({ messages: [{ content: 'one' }] })
      .mockRejectedValueOnce(new Error('two failed'));

    expect(await runDueTasks(5)).toBe(2);

    expect(state.claimDueTasks).toHaveBeenCalledWith(5);
    expect(state.finishTask).toHaveBeenNthCalledWith(1, task, { result: 'one' });
    expect(state.finishTask).toHaveBeenNthCalledWith(2, second, { error: 'two failed' });
  });
});

describe('startScheduler', () => {
  it('checks for due tasks on every tick and stops when asked', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    state.claimDueTasks.mockResolvedValue([]);

    const stop = startScheduler(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.claimDueTasks).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.claimDueTasks).toHaveBeenCalledTimes(3);
  });

  it('skips a tick while the last tick still runs', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let release: () => void = () => {};
    state.claimDueTasks.mockReturnValue(new Promise<never[]>((resolve) => {
      release = () => resolve([]);
    }));

    const stop = startScheduler(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.claimDueTasks).toHaveBeenCalledTimes(1);

    release();
    stop();
  });

  it('keeps running after a failed tick', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.claimDueTasks.mockRejectedValueOnce(new Error('db down')).mockResolvedValue([]);

    const stop = startScheduler(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.claimDueTasks).toHaveBeenCalledTimes(2);
    stop();
  });
});
