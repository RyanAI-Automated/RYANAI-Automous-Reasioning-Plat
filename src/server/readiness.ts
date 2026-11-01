export type ReadinessProbe = () => Promise<unknown>;

export interface ReadinessProbeSet {
  database: ReadinessProbe;
  redis: ReadinessProbe;
  agentCheckpointerInitialized: boolean;
  apiListening: boolean;
}

export interface ReadinessResult {
  ready: boolean;
  services: {
    database: boolean;
    redis: boolean;
    agentCheckpointer: boolean;
    api: boolean;
  };
}

async function probe(
  probeService: ReadinessProbe,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(probeService)
        .then(
          () => true,
          () => false,
        ),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    return result;
  } catch {
    // Never expose connection strings or raw provider/client errors in health output.
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Evaluate dependency readiness using live PostgreSQL and Redis probes.
 * Checkpointer readiness requires successful startup initialization and a live
 * PostgreSQL connection because the saver shares the configured database.
 */
export async function inspectReadiness(
  probes: ReadinessProbeSet,
  timeoutMs = 1500,
): Promise<ReadinessResult> {
  const boundedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(timeoutMs, 10_000))
    : 1500;
  const [database, redis] = await Promise.all([
    probe(probes.database, boundedTimeoutMs),
    probe(probes.redis, boundedTimeoutMs),
  ]);
  const services = {
    database,
    redis,
    agentCheckpointer: probes.agentCheckpointerInitialized && database,
    api: probes.apiListening,
  };

  return {
    ready: Object.values(services).every(Boolean),
    services,
  };
}
