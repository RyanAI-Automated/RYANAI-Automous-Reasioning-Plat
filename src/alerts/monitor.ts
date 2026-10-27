export type CheckResult =
  | { status: 'ok' }
  | { status: 'fail'; detail: string }
  /** The check could not run, for example because GitHub did not answer. This says nothing about the target. */
  | { status: 'skip'; detail: string };

export interface CheckState {
  /** Failures in a row. */
  failures: number;
  /** When the last "down" alert or reminder went out. Null when no alert is open. */
  alertedAt: number | null;
}

export type AlertEvent = 'down' | 'reminder' | 'recovered';

export interface MonitorOptions {
  failuresBeforeAlert: number;
  reminderMs: number;
}

export const initialState: CheckState = { failures: 0, alertedAt: null };

/**
 * Decide what one check result means.
 * - A check must fail `failuresBeforeAlert` times in a row before it raises "down".
 *   One slow answer does not wake the owner.
 * - While it stays down, it sends a "reminder" every `reminderMs`, and nothing between.
 * - The first good answer after an alert raises "recovered".
 * - A skipped check changes nothing.
 */
export function step(
  previous: CheckState,
  result: CheckResult,
  nowMs: number,
  options: MonitorOptions,
): { state: CheckState; event: AlertEvent | null } {
  if (result.status === 'skip') return { state: previous, event: null };

  if (result.status === 'ok') {
    return {
      state: initialState,
      event: previous.alertedAt !== null ? 'recovered' : null,
    };
  }

  const failures = previous.failures + 1;
  if (previous.alertedAt === null) {
    return failures >= options.failuresBeforeAlert
      ? { state: { failures, alertedAt: nowMs }, event: 'down' }
      : { state: { failures, alertedAt: null }, event: null };
  }
  return nowMs - previous.alertedAt >= options.reminderMs
    ? { state: { failures, alertedAt: nowMs }, event: 'reminder' }
    : { state: { failures, alertedAt: previous.alertedAt }, event: null };
}

/** The text of an alert. It has one headline line, then the detail. */
export function describeEvent(label: string, event: AlertEvent, detail: string): string {
  switch (event) {
    case 'down':
      return `DOWN: ${label}\n${detail}`;
    case 'reminder':
      return `STILL DOWN: ${label}\n${detail}`;
    case 'recovered':
      return `RECOVERED: ${label}\nThe check passes again.`;
  }
}
