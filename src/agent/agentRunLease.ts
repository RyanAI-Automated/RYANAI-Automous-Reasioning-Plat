export interface AgentRunLease {
  id: string;
  workerId: string;
  attempts: number;
}

/** A worker owns a run only while its worker ID and claim attempt still match. */
export function agentRunLeaseFilter(lease: AgentRunLease) {
  return {
    id: lease.id,
    status: 'running' as const,
    workerId: lease.workerId,
    attempts: lease.attempts,
  };
}

/**
 * Keep long-running work leased. The attempt + worker ID filter fences stale
 * workers after another worker has reclaimed an expired lease.
 */
export function startAgentRunLeaseHeartbeat(
  lease: AgentRunLease,
  refresh: (where: ReturnType<typeof agentRunLeaseFilter>) => Promise<{ count: number }>,
  onError: (error: unknown) => void = () => undefined,
  intervalMs = 30_000,
): () => void {
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const result = await refresh(agentRunLeaseFilter(lease));
      if (!stopped && result.count !== 1) {
        onError(new Error('Agent run lease ownership was lost; this worker must stop processing.'));
      }
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      inFlight = false;
    }
  }, Math.max(1_000, intervalMs));
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
