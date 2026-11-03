/**
 * Shared PostgreSQL connection contract for the API pool and LangGraph saver.
 * Never include credentials or query parameters in diagnostics or telemetry.
 */
export interface DatabaseBackendIdentity {
  protocol: string;
  host: string;
  port: number;
  database: string;
  sslMode: string | null;
}

const LOCAL_DEVELOPMENT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ryanai';

export function resolveDatabaseConnectionUrl(
  nodeEnv: string,
  databaseUrl?: string,
): string {
  const configured = databaseUrl?.trim();

  if (nodeEnv === 'production' && !configured) {
    throw new Error(
      'Missing required production connection configuration: DATABASE_URL. Set this variable before starting the API.',
    );
  }

  const resolved = configured || LOCAL_DEVELOPMENT_DATABASE_URL;
  // Validate scheme/port without echoing the supplied URL in any error.
  describeDatabaseBackend(resolved);
  return resolved;
}

/**
 * Return only non-secret backend coordinates. Username, password, fragments,
 * and all query parameters except sslmode are deliberately excluded.
 */
export function describeDatabaseBackend(databaseUrl: string): DatabaseBackendIdentity {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL.');
  }

  const protocol = parsed.protocol.replace(':', '').toLowerCase();
  if (protocol !== 'postgres' && protocol !== 'postgresql') {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }

  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DATABASE_URL contains an invalid PostgreSQL port.');
  }

  return {
    protocol,
    host: parsed.hostname.toLowerCase(),
    port,
    database: decodeURIComponent(parsed.pathname.replace(/^\\//, '')),
    sslMode: parsed.searchParams.get('sslmode'),
  };
}

export function assertSameDatabaseBackend(
  apiDatabaseUrl: string,
  checkpointerDatabaseUrl: string,
): void {
  const apiBackend = describeDatabaseBackend(apiDatabaseUrl);
  const checkpointerBackend = describeDatabaseBackend(checkpointerDatabaseUrl);

  if (JSON.stringify(apiBackend) !== JSON.stringify(checkpointerBackend)) {
    throw new Error(
      'Database backend mismatch: API pool and agent checkpointer must target the same PostgreSQL backend.',
    );
  }
}
