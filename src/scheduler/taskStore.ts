import {
  MAX_ACTIVE_TASKS_PER_USER,
  nextRunAfter,
  type ResolvedSchedule,
} from './schedule.js';

const LEASE_MS = 10 * 60_000;
const LIST_LIMIT = 50;

/** Load the Prisma client on first use, so importing this file creates no database client. */
async function getPrisma() {
  const { prisma } = await import('../lib/prisma.js');
  return prisma;
}

export interface DueTask {
  id: string;
  userId: string;
  prompt: string;
  intervalMinutes: number | null;
}

export interface RunOutcome {
  result?: string;
  error?: string;
}

/**
 * Create a task for a user.
 * shortcut: the quota check and the insert are two statements, so two parallel
 * requests can pass the limit by one or two tasks. Use a conditional insert if
 * the limit must be exact.
 */
export async function createTask(userId: string, prompt: string, schedule: ResolvedSchedule) {
  const prisma = await getPrisma();
  const active = await prisma.scheduledTask.count({ where: { userId, status: 'active' } });
  if (active >= MAX_ACTIVE_TASKS_PER_USER) {
    throw new Error(`You can have at most ${MAX_ACTIVE_TASKS_PER_USER} active scheduled tasks.`);
  }
  return prisma.scheduledTask.create({
    data: {
      userId,
      prompt,
      runAt: schedule.runAt,
      intervalMinutes: schedule.intervalMinutes,
    },
    select: { id: true, runAt: true, intervalMinutes: true },
  });
}

/** The tasks of one user that are not cancelled, newest first. */
export async function listTasks(userId: string) {
  const prisma = await getPrisma();
  return prisma.scheduledTask.findMany({
    where: { userId, status: { not: 'cancelled' } },
    orderBy: { createdAt: 'desc' },
    take: LIST_LIMIT,
    select: {
      id: true,
      prompt: true,
      status: true,
      runAt: true,
      intervalMinutes: true,
      lastRunAt: true,
      lastResult: true,
      lastError: true,
    },
  });
}

/** Cancel an active task of the user. Returns false when there is no such task. */
export async function cancelTask(userId: string, id: string) {
  const prisma = await getPrisma();
  const { count } = await prisma.scheduledTask.updateMany({
    where: { id, userId, status: 'active' },
    data: { status: 'cancelled', lockedUntil: null },
  });
  return count === 1;
}

/**
 * Claim up to `limit` due tasks for this process. A claim is one conditional
 * UPDATE that sets a 10-minute lease. Only one process can win the update for
 * a task, so two servers never run the same task. If a process stops in the
 * middle of a run, the lease ends and the task runs again (at-least-once).
 */
export async function claimDueTasks(limit: number, now: Date = new Date()): Promise<DueTask[]> {
  const prisma = await getPrisma();
  const free = [{ lockedUntil: null }, { lockedUntil: { lt: now } }];
  const due = await prisma.scheduledTask.findMany({
    where: { status: 'active', runAt: { lte: now }, OR: free },
    orderBy: { runAt: 'asc' },
    take: limit,
    select: { id: true, userId: true, prompt: true, intervalMinutes: true },
  });

  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const claimed: DueTask[] = [];
  for (const task of due) {
    const { count } = await prisma.scheduledTask.updateMany({
      where: { id: task.id, status: 'active', OR: free },
      data: { lockedUntil: leaseUntil },
    });
    if (count === 1) claimed.push(task);
  }
  return claimed;
}

/**
 * Record the result of a run. A repeating task gets its next run time. A
 * one-time task is done, also after an error, so it never retries without end.
 * A task that the user cancelled during the run stays cancelled.
 */
export async function finishTask(task: DueTask, outcome: RunOutcome, now: Date = new Date()) {
  const prisma = await getPrisma();
  const next = nextRunAfter(task.intervalMinutes, now);
  await prisma.scheduledTask.updateMany({
    where: { id: task.id, status: 'active' },
    data: {
      lastRunAt: now,
      lastResult: outcome.result ?? null,
      lastError: outcome.error ?? null,
      lockedUntil: null,
      ...(next ? { runAt: next } : { status: 'done' }),
    },
  });
}
