/** Retry policy for durable autonomous runs. Attempts are counted when a worker claims a run. */
export function shouldRetryAgentRun(attempts: number, maxAttempts: number): boolean {
  return Number.isInteger(attempts) && Number.isInteger(maxAttempts)
    && attempts >= 1 && maxAttempts >= 1 && attempts < maxAttempts;
}

/** Exponential retry delay, capped at one minute. */
export function getAgentRunRetryDelayMs(attempts: number): number {
  const safeAttempt = Number.isInteger(attempts) && attempts > 0 ? attempts : 1;
  return Math.min(60_000, 5_000 * (2 ** (safeAttempt - 1)));
}
