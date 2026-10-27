import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { requireUserId } from './toolContext.js';
import { UUID_PATTERN, resolveSchedule } from '../../scheduler/schedule.js';
import { cancelTask, createTask, listTasks } from '../../scheduler/taskStore.js';

const RESULT_PREVIEW_CHARS = 500;

export const scheduleTaskTool = tool(
  async ({ prompt, runAt, delayMinutes, repeatEveryMinutes }, config) => {
    const userId = requireUserId(config);
    const schedule = resolveSchedule({ runAt, delayMinutes, repeatEveryMinutes });
    const task = await createTask(userId, prompt, schedule);
    return JSON.stringify({
      scheduled: true,
      id: task.id,
      runAt: task.runAt.toISOString(),
      repeatEveryMinutes: task.intervalMinutes,
    });
  },
  {
    name: 'schedule_task',
    description:
      'Schedules a task for RyanAI to run later without the user present. Give either runAt (ISO 8601 with an offset, for example 2026-10-28T09:00:00+02:00) or delayMinutes. Add repeatEveryMinutes (15 to 10080) to repeat it. The unattended run can read and save notes only. It cannot send messages. The user reads the result later.',
    schema: z.object({
      prompt: z.string().min(1).max(2000).describe('What to do when the task runs. Write it so that it makes sense without this chat.'),
      runAt: z.string().optional().describe('First run time, ISO 8601 with an offset'),
      delayMinutes: z.number().int().optional().describe('Minutes from now until the first run'),
      repeatEveryMinutes: z.number().int().optional().describe('Repeat interval in minutes'),
    }),
  },
);

export const listScheduledTasksTool = tool(
  async (_input, config) => {
    const userId = requireUserId(config);
    const tasks = await listTasks(userId);
    return JSON.stringify({
      count: tasks.length,
      tasks: tasks.map((task) => ({
        id: task.id,
        prompt: task.prompt,
        status: task.status,
        nextRunAt: task.status === 'active' ? task.runAt.toISOString() : null,
        repeatEveryMinutes: task.intervalMinutes,
        lastRunAt: task.lastRunAt?.toISOString() ?? null,
        lastResult: task.lastResult?.slice(0, RESULT_PREVIEW_CHARS) ?? null,
        lastError: task.lastError,
      })),
    });
  },
  {
    name: 'list_scheduled_tasks',
    description: 'Lists the scheduled tasks of the user with their status and last result.',
    schema: z.object({}),
  },
);

export const cancelScheduledTaskTool = tool(
  async ({ id }, config) => {
    const userId = requireUserId(config);
    return JSON.stringify({ cancelled: await cancelTask(userId, id) });
  },
  {
    name: 'cancel_scheduled_task',
    description: 'Cancels an active scheduled task by its id.',
    schema: z.object({
      id: z.string().regex(UUID_PATTERN).describe('The id from list_scheduled_tasks'),
    }),
  },
);

export const scheduleTools = [scheduleTaskTool, listScheduledTasksTool, cancelScheduledTaskTool];
