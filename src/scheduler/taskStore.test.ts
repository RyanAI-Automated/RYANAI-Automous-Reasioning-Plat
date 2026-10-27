import { beforeEach, describe, expect, it, vi } from 'vitest';

const task = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({ prisma: { scheduledTask: task } }));

import { MAX_ACTIVE_TASKS_PER_USER } from './schedule.js';
import { cancelTask, claimDueTasks, createTask, finishTask, listTasks } from './taskStore.js';

const now = new Date('2026-10-27T10:00:00Z');
const schedule = { runAt: new Date('2026-10-27T11:00:00Z'), intervalMinutes: null };

beforeEach(() => vi.clearAllMocks());

describe('createTask', () => {
  it('stops at the limit of active tasks and creates nothing', async () => {
    task.count.mockResolvedValue(MAX_ACTIVE_TASKS_PER_USER);
    await expect(createTask('user-1', 'do it', schedule)).rejects.toThrow(/at most/);
    expect(task.create).not.toHaveBeenCalled();
  });

  it('creates the task for the user', async () => {
    task.count.mockResolvedValue(0);
    task.create.mockResolvedValue({ id: 't1', runAt: schedule.runAt, intervalMinutes: null });
    await createTask('user-1', 'do it', schedule);
    expect(task.count).toHaveBeenCalledWith({ where: { userId: 'user-1', status: 'active' } });
    expect(task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user-1', prompt: 'do it', runAt: schedule.runAt, intervalMinutes: null },
      }),
    );
  });
});

describe('listTasks and cancelTask', () => {
  it('lists only the tasks of the user, without cancelled ones', async () => {
    task.findMany.mockResolvedValue([]);
    await listTasks('user-1');
    expect(task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: { not: 'cancelled' } } }),
    );
  });

  it('cancels only an active task of the user', async () => {
    task.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await cancelTask('user-1', 't1')).toBe(true);
    expect(task.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', userId: 'user-1', status: 'active' },
      data: { status: 'cancelled', lockedUntil: null },
    });
    expect(await cancelTask('user-2', 't1')).toBe(false);
  });
});

describe('claimDueTasks', () => {
  it('keeps only the tasks that this process won, and sets a 10-minute lease', async () => {
    const a = { id: 'a', userId: 'u', prompt: 'p', intervalMinutes: null };
    const b = { id: 'b', userId: 'u', prompt: 'p', intervalMinutes: 60 };
    task.findMany.mockResolvedValue([a, b]);
    task.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const claimed = await claimDueTasks(5, now);

    expect(claimed).toEqual([a]);
    expect(task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active', runAt: { lte: now } }),
        take: 5,
      }),
    );
    expect(task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'a', status: 'active' }),
        data: { lockedUntil: new Date('2026-10-27T10:10:00Z') },
      }),
    );
  });
});

describe('finishTask', () => {
  it('schedules the next run of a repeating task', async () => {
    await finishTask({ id: 't1', userId: 'u', prompt: 'p', intervalMinutes: 60 }, { result: 'ok' }, now);
    expect(task.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: 'active' },
      data: {
        lastRunAt: now,
        lastResult: 'ok',
        lastError: null,
        lockedUntil: null,
        runAt: new Date('2026-10-27T11:00:00Z'),
      },
    });
  });

  it('marks a one-time task done, also after an error', async () => {
    await finishTask({ id: 't2', userId: 'u', prompt: 'p', intervalMinutes: null }, { error: 'boom' }, now);
    expect(task.updateMany).toHaveBeenCalledWith({
      where: { id: 't2', status: 'active' },
      data: {
        lastRunAt: now,
        lastResult: null,
        lastError: 'boom',
        lockedUntil: null,
        status: 'done',
      },
    });
  });
});
