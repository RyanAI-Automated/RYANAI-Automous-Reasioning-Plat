export interface ConnectionUrls {
  databaseUrl: string;
  redisUrl: string;
}

/**
 * Trust only the configured number of reverse-proxy hops when resolving client
 * IPs. A finite hop count prevents arbitrary client-supplied X-Forwarded-For
 * entries from being treated as authoritative. The default is one hop; set
 * TRUST_PROXY_HOPS only after verifying the deployment's proxy topology.
 */
export function resolveTrustedProxyHops(raw?: string): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const hops = Number(raw.trim());
  if (!Number.isSafeInteger(hops) || hops < 1 || hops > 5) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 1 and 5.');
  }
  return hops;
}

function localDevelopmentDatabaseUrl(): string {
  const url = new URL('postgresql://localhost:5432/ryanai');
  url.username = 'postgres';
  url.password = 'postgres';
  return url.toString();
}

/**
 * Resolve required service URLs without silently selecting local services in production.
 * Local defaults remain available only for development and test environments.
 */
export function resolveConnectionUrls(
  nodeEnv: string,
  databaseUrl?: string,
  redisUrl?: string,
): ConnectionUrls {
  const database = databaseUrl?.trim();
  const redis = redisUrl?.trim();

  if (nodeEnv === 'production') {
    const missing = [
      !database ? 'DATABASE_URL' : undefined,
      !redis ? 'REDIS_URL' : undefined,
    ].filter(Boolean);

    if (missing.length) {
      throw new Error(
        `Missing required production connection configuration: ${missing.join(', ')}. Set these variables before starting the API.`,
      );
    }
  }

  return {
    databaseUrl: database || localDevelopmentDatabaseUrl(),
    redisUrl: redis || 'redis://localhost:6379',
  };
}


/**
 * Prevent a production API process from listening when required infrastructure
 * failed its startup connectivity check. Non-production environments retain
 * degraded-start behavior for local development and isolated tests.
 */
export function assertProductionDependencies(
  nodeEnv: string,
  services: { database: boolean; redis: boolean; agentCheckpointer: boolean; applicationSchema: boolean },
): void {
  if (nodeEnv !== 'production') return;

  const unavailable = [
    !services.database ? 'PostgreSQL' : undefined,
    !services.redis ? 'Redis' : undefined,
    !services.agentCheckpointer ? 'agent checkpointer' : undefined,
    !services.applicationSchema ? 'application Prisma schema' : undefined,
  ].filter(Boolean);

  if (unavailable.length) {
    throw new Error(
      `Production startup blocked: required dependency checks failed for ${unavailable.join(', ')}. The API listener was not started.`,
    );
  }
}
