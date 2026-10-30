export interface ConnectionUrls {
  databaseUrl: string;
  redisUrl: string;
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
    databaseUrl: database || 'postgresql://postgres:postgres@localhost:5432/ryanai',
    redisUrl: redis || 'redis://localhost:6379',
  };
}
