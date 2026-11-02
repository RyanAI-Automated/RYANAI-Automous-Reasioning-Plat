/**
 * PostgreSQL LISTEN/NOTIFY is a wake-up optimization, not the durable queue.
 * The committed agent_runs row remains authoritative if notification delivery
 * fails; the worker's periodic recovery sweep will discover it.
 */
export async function publishAgentTaskNotification(
  runId: string,
  notify: (id: string) => Promise<unknown>,
): Promise<boolean> {
  try {
    await notify(runId);
    return true;
  } catch {
    return false;
  }
}
