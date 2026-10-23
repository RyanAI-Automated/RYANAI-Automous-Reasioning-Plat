const connectionHints: Record<string, string> = {
  ECONNREFUSED:
    'Connection refused. Check that PostgreSQL is running and the configured host and port are reachable.',
  ENOTFOUND:
    'Database hostname could not be resolved. Check the host in DATABASE_URL.',
  EAI_AGAIN:
    'Database hostname lookup temporarily failed. Check DNS and retry.',
  ETIMEDOUT:
    'Connection timed out. Check database reachability and network rules.',
  ECONNRESET:
    'Connection was reset. Check database availability and TLS settings.',
  '28P01':
    'Password authentication failed. Check the database credentials in DATABASE_URL.',
  '28000':
    'Database authorization failed. Check the database user and server access rules.',
  '3D000':
    'The configured database does not exist. Check the database name in DATABASE_URL.',
  '53300':
    'PostgreSQL has too many connections. Check server connection capacity.',
  '57P03':
    'PostgreSQL is not accepting connections yet. Check server readiness and retry.',
};

/**
 * Summarize recognized database failures without exposing raw error details.
 * Traversal is bounded and handles cyclic causes and aggregate errors.
 */
export function databaseFailureDiagnostic(error: unknown): string {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const codes = new Set<string>();
  for (let visited = 0; pending.length && visited < 32; visited++) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const detail = current as {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (
      typeof detail.code === 'string' &&
      Object.hasOwn(connectionHints, detail.code)
    ) {
      codes.add(detail.code);
    }
    if (detail.cause) pending.push(detail.cause);
    if (Array.isArray(detail.errors))
      pending.push(...detail.errors.slice(0, 16));
  }
  if (!codes.size) {
    return 'Cause unavailable. Check DATABASE_URL, PostgreSQL availability, and database server logs. Raw error details are omitted to protect credentials.';
  }
  return [...codes]
    .map((code) => `${code}: ${connectionHints[code]}`)
    .join(' ');
}

export interface StartupServices {
  database: boolean;
  redis: boolean;
  agentCheckpointer: boolean;
  api: boolean;
}

/** Describe the startup service snapshot, naming any unavailable services. */
export function startupSummary(services: StartupServices): string {
  const unavailable = (
    Object.keys(services) as (keyof StartupServices)[]
  ).filter((name) => !services[name]);
  return unavailable.length
    ? `⚠️ Startup degraded. Unavailable services: ${unavailable.join(', ')}.`
    : '🟢 All services ready!';
}
