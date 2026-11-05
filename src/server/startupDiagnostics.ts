const connectionHints: Record<string, string> = {
  ECONNREFUSED:
    'Connection refused. Check that PostgreSQL is running and the configured host and port are reachable.',
  ENOTFOUND:
    'Database hostname could not be resolved. Copy the exact Session Pooler host from Supabase Connect and check DNS resolution.',
  EAI_AGAIN:
    'Database hostname lookup temporarily failed. Check DNS and retry.',
  ETIMEDOUT:
    'Connection timed out. Check database reachability and network rules.',
  ECONNRESET:
    'Connection was reset. Check database availability and TLS settings.',
  ERR_TLS_CERT_ALTNAME_INVALID:
    'TLS certificate hostname validation failed. Verify the exact pooler hostname copied from Supabase Connect.',
  SELF_SIGNED_CERT_IN_CHAIN:
    'TLS certificate chain could not be verified. Check the runtime CA store and database endpoint.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    'TLS certificate chain could not be verified. Check the runtime CA store and database endpoint.',
  CERT_HAS_EXPIRED:
    'The database endpoint presented an expired TLS certificate.',
  ERR_SSL_WRONG_VERSION_NUMBER:
    'TLS negotiation failed. Confirm the PostgreSQL endpoint and port are correct.',
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
  const unclassifiedCodes = new Set<string>();
  for (let visited = 0; pending.length && visited < 32; visited++) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const detail = current as {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof detail.code === 'string') {
      if (Object.hasOwn(connectionHints, detail.code)) {
        codes.add(detail.code);
      } else if (
        /^[A-Z][A-Z0-9_]{1,63}$/.test(detail.code) ||
        /^[0-9A-Z]{5}$/.test(detail.code)
      ) {
        // Error codes are safe diagnostic metadata; messages and URLs are not.
        unclassifiedCodes.add(detail.code);
      }
    }
    if (detail.cause) pending.push(detail.cause);
    if (Array.isArray(detail.errors))
      pending.push(...detail.errors.slice(0, 16));
  }
  const known = [...codes].map((code) => `${code}: ${connectionHints[code]}`);
  const unclassified = [...unclassifiedCodes].map(
    (code) =>
      `${code}: Unclassified database transport error. Verify the exact Supabase Session Pooler host and project-qualified username, TLS settings, and database availability.`,
  );
  const diagnostics = [...known, ...unclassified];
  if (!diagnostics.length) {
    return 'Cause unavailable. Check DATABASE_URL, the exact Supabase Session Pooler endpoint, PostgreSQL availability, and database server logs. Raw error details are omitted to protect credentials.';
  }
  return diagnostics.join(' ');
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
