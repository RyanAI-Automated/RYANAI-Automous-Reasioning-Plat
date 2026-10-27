import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  createTask: vi.fn(),
  listTasks: vi.fn(),
  cancelTask: vi.fn(),
}));
vi.mock('../../scheduler/taskStore.js', () => store);

import {
  cancelScheduledTaskTool,
  listScheduledTasksTool,
  scheduleTaskTool,
} from './scheduleTools.js';

const asUser = { configurable: { userId: 'user-1' } };
const taskId = '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11';

beforeEach(() => vi.clearAllMocks());

describe('schedule_task', () => {
  it('creates a task for the signed-in user', async () => {
    store.createTask.mockResolvedValue({
      id: taskId,
      runAt: new Date('2026-10-27T11:00:00Z'),
      intervalMinutes: 60,
    });
    const result = await scheduleTaskTool.invoke(
      { prompt: 'Summarise my notes', delayMinutes: 30, repeatEveryMinutes: 60 },
      asUser,
    );
    expect(store.createTask).toHaveBeenCalledWith(
      'user-1',
      'Summarise my notes',
      expect.objectContaining({ intervalMinutes: 60, runAt: expect.any(Date) }),
    );
    expect(JSON.parse(result)).toEqual({
      scheduled: true,
      id: taskId,
      runAt: '2026-10-27T11:00:00.000Z',
      repeatEveryMinutes: 60,
    });
  });

  it('refuses an invalid schedule without creating a task', async () => {
    await expect(
      scheduleTaskTool.invoke(
        { prompt: 'x', runAt: '2030-01-01T00:00:00Z', delayMinutes: 5 },
        asUser,
      ),
    ).rejects.toThrow(/either runAt or delayMinutes/);
    expect(store.createTask).not.toHaveBeenCalled();
  });

  it('fails without an authenticated user', async () => {
    await expect(scheduleTaskTool.invoke({ prompt: 'x', delayMinutes: 5 })).rejects.toThrow(
      /authenticated user/,
    );
    expect(store.createTask).not.toHaveBeenCalled();
  });
});

describe('list_scheduled_tasks', () => {
  it('lists the tasks of the user and cuts long results', async () => {
    store.listTasks.mockResolvedValue([
      {
        id: taskId,
        prompt: 'p',
        status: 'active',
        runAt: new Date('2026-10-27T11:00:00Z'),
        intervalMinutes: null,
        lastRunAt: null,
        lastResult: 'r'.repeat(900),
        lastError: null,
      },
    ]);
    const result = JSON.parse(await listScheduledTasksTool.invoke({}, asUser));
    expect(store.listTasks).toHaveBeenCalledWith('user-1');
    expect(result.count).toBe(1);
    expect(result.tasks[0].nextRunAt).toBe('2026-10-27T11:00:00.000Z');
    expect(result.tasks[0].lastResult).toHaveLength(500);
  });
});

describe('cancel_scheduled_task', () => {
  it('cancels a task of the user', async () => {
    store.cancelTask.mockResolvedValue(true);
    const result = await cancelScheduledTaskTool.invoke({ id: taskId }, asUser);
    expect(store.cancelTask).toHaveBeenCalledWith('user-1', taskId);
    expect(JSON.parse(result)).toEqual({ cancelled: true });
  });

  it('rejects an id that is not a UUID before it reaches the database', async () => {
    await expect(cancelScheduledTaskTool.invoke({ id: 'not-an-id' }, asUser)).rejects.toThrow();
    expect(store.cancelTask).not.toHaveBeenCalled();
  });
});
