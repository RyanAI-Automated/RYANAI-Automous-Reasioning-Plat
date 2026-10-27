import { getScheduledAgent } from '../agent/scheduledAgent.js';
import { buildMemoryContext } from '../agent/memoryContext.js';
import { databaseFailureDiagnostic } from '../server/startupDiagnostics.js';
import { claimDueTasks, finishTask, type DueTask, type RunOutcome } from './taskStore.js';

const RUN_TIMEOUT_MS = 120_000;
const MAX_RESULT_CHARS = 8000;
const MAX_ERROR_CHARS = 1000;
const BATCH_SIZE = 5;

/** Run one task with the unattended agent. Never throws: a failure becomes the outcome. */
export async function runScheduledTask(task: DueTask): Promise<RunOutcome> {
  try {
    const memory = await buildMemoryContext(task.userId);
    const output = await getScheduledAgent().invoke(
      {
        messages: [
          ...(memory ? [{ role: 'system', content: memory }] : []),
          { role: 'user', content: task.prompt },
        ],
      },
      {
        configurable: { userId: task.userId, role: 'user' },
        recursionLimit: 15,
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      },
    );
    const last = output.messages.at(-1)?.content;
    const text = typeof last === 'string' ? last : (JSON.stringify(last ?? '') ?? '');
    return { result: text.slice(0, MAX_RESULT_CHARS) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message.slice(0, MAX_ERROR_CHARS) };
  }
}

/** Claim the due tasks and run them one after the other. Returns how many ran. */
export async function runDueTasks(limit: number = BATCH_SIZE): Promise<number> {
  const tasks = await claimDueTasks(limit);
  for (const task of tasks) {
    await finishTask(task, await runScheduledTask(task));
  }
  return tasks.length;
}

/**
 * Check for due tasks every `pollMs`. A tick that is still running makes the
 * next tick skip, so runs never overlap in one process. Returns a function
 * that stops the timer.
 */
export function startScheduler(pollMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDueTasks();
    } catch (error) {
      console.error('[scheduler] Tick failed:', databaseFailureDiagnostic(error));
    } finally {
      running = false;
    }
  }, pollMs);
  timer.unref();
  console.log(`[scheduler] Started. Checking for due tasks every ${Math.round(pollMs / 1000)} seconds.`);
  return () => clearInterval(timer);
}
