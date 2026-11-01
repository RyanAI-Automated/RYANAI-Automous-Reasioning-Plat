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


/** Run at most two provider attempts, but never retry after parent lease cancellation. */
export async function invokeWithCancellationRetry<T>(
  invoke: (attempt: number) => Promise<T>,
  cancellationSignal?: AbortSignal,
  retryDelayMs = 400,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (cancellationSignal?.aborted) {
      throw cancellationSignal.reason instanceof Error
        ? cancellationSignal.reason
        : new Error('Invocation cancelled because the worker no longer owns its lease.');
    }
    try {
      return await invoke(attempt);
    } catch (error) {
      lastError = error;
      if (cancellationSignal?.aborted) {
        throw cancellationSignal.reason instanceof Error
          ? cancellationSignal.reason
          : new Error('Invocation cancelled because the worker no longer owns its lease.');
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
