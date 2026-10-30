import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentRunLeaseFilter, startAgentRunLeaseHeartbeat } from './agentRunLease.js';

afterEach(() => vi.useRealTimers());

describe('durable agent worker lease fencing', () => {
  it('uses run ID, worker ID, and claim attempt as the ownership fence', () => {
    expect(agentRunLeaseFilter({ id: 'run-1', workerId: 'worker-a', attempts: 2 })).toEqual({
      id: 'run-1',
      status: 'running',
      workerId: 'worker-a',
      attempts: 2,
    });
  });

  it('refreshes the owned lease on its heartbeat interval', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue({ count: 1 });
    const stop = startAgentRunLeaseHeartbeat(
      { id: 'run-2', workerId: 'worker-b', attempts: 1 },
      refresh,
      vi.fn(),
      5_000,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith({
      id: 'run-2',
      status: 'running',
      workerId: 'worker-b',
      attempts: 1,
    });
    stop();
  });

  it('does not refresh after shutdown', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue({ count: 1 });
    const stop = startAgentRunLeaseHeartbeat(
      { id: 'run-3', workerId: 'worker-c', attempts: 3 },
      refresh,
      vi.fn(),
      5_000,
    );
    stop();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports refresh errors without throwing out of the worker loop', async () => {
    vi.useFakeTimers();
    const error = new Error('database temporarily unavailable');
    const refresh = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const stop = startAgentRunLeaseHeartbeat(
      { id: 'run-4', workerId: 'worker-d', attempts: 1 },
      refresh,
      onError,
      5_000,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onError).toHaveBeenCalledWith(error);
    stop();
  });
});
