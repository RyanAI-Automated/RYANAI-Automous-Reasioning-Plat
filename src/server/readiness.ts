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

async function probe(probeService: ReadinessProbe): Promise<boolean> {
  try {
    await probeService();
    return true;
  } catch {
    // Never expose connection strings or raw provider/client errors in health output.
    return false;
  }
}

/**
 * Evaluate dependency readiness using live PostgreSQL and Redis probes.
 * Checkpointer readiness requires successful startup initialization and a live
 * PostgreSQL connection because the saver shares the configured database.
 */
export async function inspectReadiness(
  probes: ReadinessProbeSet,
): Promise<ReadinessResult> {
  const [database, redis] = await Promise.all([
    probe(probes.database),
    probe(probes.redis),
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
