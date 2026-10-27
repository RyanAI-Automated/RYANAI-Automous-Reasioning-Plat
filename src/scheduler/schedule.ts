export const MIN_REPEAT_MINUTES = 15;
export const MAX_REPEAT_MINUTES = 10_080;
export const MAX_DELAY_MINUTES = 525_600;
export const MAX_ACTIVE_TASKS_PER_USER = 20;

/** The shape of a task id. A different text would make the database reject the query. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MINUTE_MS = 60_000;
// An ISO 8601 date-time must name its offset. A bare local time has no meaning on a server.
const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;

export interface ScheduleRequest {
  runAt?: string;
  delayMinutes?: number;
  repeatEveryMinutes?: number;
}

export interface ResolvedSchedule {
  runAt: Date;
  intervalMinutes: number | null;
}

function checkMinutes(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
}

/**
 * Turn a request into the first run time and the repeat interval.
 * Give exactly one of runAt (ISO 8601 with an offset) or delayMinutes.
 */
export function resolveSchedule(
  request: ScheduleRequest,
  now: Date = new Date(),
): ResolvedSchedule {
  const { runAt, delayMinutes, repeatEveryMinutes } = request;
  if ((runAt === undefined) === (delayMinutes === undefined)) {
    throw new Error('Give either runAt or delayMinutes, but not both and not neither.');
  }

  let firstRun: Date;
  if (delayMinutes !== undefined) {
    checkMinutes('delayMinutes', delayMinutes, 1, MAX_DELAY_MINUTES);
    firstRun = new Date(now.getTime() + delayMinutes * MINUTE_MS);
  } else {
    if (!HAS_OFFSET.test(runAt!)) {
      throw new Error('runAt must include an offset, for example 2026-10-28T09:00:00+02:00.');
    }
    firstRun = new Date(runAt!);
    if (Number.isNaN(firstRun.getTime())) {
      throw new Error('runAt is not a valid date.');
    }
    // Allow one minute of clock difference between the caller and the server.
    if (firstRun.getTime() < now.getTime() - MINUTE_MS) {
      throw new Error('runAt is in the past.');
    }
    if (firstRun.getTime() > now.getTime() + MAX_DELAY_MINUTES * MINUTE_MS) {
      throw new Error('runAt is more than one year ahead.');
    }
  }

  if (repeatEveryMinutes !== undefined) {
    checkMinutes('repeatEveryMinutes', repeatEveryMinutes, MIN_REPEAT_MINUTES, MAX_REPEAT_MINUTES);
  }
  return { runAt: firstRun, intervalMinutes: repeatEveryMinutes ?? null };
}

/** The next run time after a run that finished at `now`. Null for a one-time task. */
export function nextRunAfter(intervalMinutes: number | null, now: Date): Date | null {
  return intervalMinutes === null ? null : new Date(now.getTime() + intervalMinutes * MINUTE_MS);
}
