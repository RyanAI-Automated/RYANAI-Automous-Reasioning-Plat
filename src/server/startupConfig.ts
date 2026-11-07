import { resolveSupabaseSessionPoolerUrl } from './supabasePooler.js';

export interface ConnectionUrls {
  databaseUrl: string;
  redisUrl: string;
}

function localDevelopmentDatabaseUrl(): string {
  const url = new URL('postgresql://localhost:5432/ryanai');
  url.username = 'postgres';
  url.password = 'postgres';
  return url.toString();
}

function isSupabaseDatabaseUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return /^db\.[a-z0-9]{20}\.supabase\.co$/.test(hostname)
      || hostname.endsWith('.pooler.supabase.com');
  } catch {
    return false;
  }
}

/**
 * Resolve required service URLs without silently selecting local services in production.
 * Supabase production URLs are normalized to the explicitly configured Session Pooler
 * endpoint before either Prisma or node-postgres receives the connection string.
 * Local defaults remain available only for development and test environments.
 */
export function resolveConnectionUrls(
  nodeEnv: string,
  databaseUrl?: string,
  redisUrl?: string,
  supabaseUrl?: string,
  sessionPoolerHost?: string,
  sslRootCertPath?: string,
): ConnectionUrls {
  let database = databaseUrl?.trim();
  const redis = redisUrl?.trim();

  if (database && isSupabaseDatabaseUrl(database)) {
    const pooler = resolveSupabaseSessionPoolerUrl(
      database,
      supabaseUrl,
      sessionPoolerHost,
      sslRootCertPath,
    );

    if (
      pooler.reason !== 'rewritten'
      && pooler.reason !== 'already-pooled'
    ) {
      throw new Error(
        `Invalid Supabase Session Pooler configuration (${pooler.reason}). Set SUPABASE_URL and the exact SUPABASE_SESSION_POOLER_HOST copied from Supabase Connect; ensure DATABASE_URL contains the database password. Credentials are not logged.`,
      );
    }

    database = pooler.databaseUrl;
  }

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
  services: { database: boolean; redis: boolean; agentCheckpointer: boolean },
): void {
  if (nodeEnv !== 'production') return;

  const unavailable = [
    !services.database ? 'PostgreSQL' : undefined,
    !services.redis ? 'Redis' : undefined,
    !services.agentCheckpointer ? 'agent checkpointer' : undefined,
  ].filter(Boolean);

  if (unavailable.length) {
    throw new Error(
      `Production startup blocked: required dependency checks failed for ${unavailable.join(', ')}. The API listener was not started.`,
    );
  }
}
