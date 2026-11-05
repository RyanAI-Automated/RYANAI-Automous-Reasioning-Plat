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
  EHOSTUNREACH:
    'The database host is unreachable from this runtime. Check its network route and address family.',
  ENETUNREACH:
    'The network route to the database is unavailable. Check IPv4/IPv6 compatibility and outbound networking.',
  EADDRNOTAVAIL:
    'The runtime could not allocate a local network address for the database connection.',
  ERR_TLS_CERT_ALTNAME_INVALID:
    'The database TLS certificate does not match the configured hostname. Verify the exact Supabase pooler host.',
  CERT_HAS_EXPIRED:
    'The database TLS certificate has expired. Verify the endpoint certificate and system clock.',
  DEPTH_ZERO_SELF_SIGNED_CERT:
    'The database endpoint presented an untrusted self-signed TLS certificate.',
  SELF_SIGNED_CERT_IN_CHAIN:
    'The database TLS certificate chain contains an untrusted self-signed certificate.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    'The database TLS certificate chain could not be verified.',
  ERR_SSL_WRONG_VERSION_NUMBER:
    'The database TLS handshake failed. Check that TLS is enabled for the selected pooler port.',
  ESSLREQUIRED:
    'Supabase Session Pooler requires TLS. Use sslmode=require or stronger.',
  ERR_INVALID_URL:
    'DATABASE_URL is malformed. Verify the connection string format and percent-encoding without exposing its password.',
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
  '08001':
    'The client could not establish a SQL connection. Check the endpoint, port, TLS and network route.',
  '08004':
    'The database rejected the connection request. Check the connection role and server access policy.',
  '08006':
    'The database connection was lost during startup. Check PostgreSQL and pooler logs.',
};

const safeMessageHints: Array<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /client password must be a string/i,
    hint: 'The database URL did not provide a usable password string. Verify that the existing secret is present and percent-encoded.',
  },
  {
    pattern: /ssl connection is required/i,
    hint: 'Supabase Session Pooler requires TLS. The client connection must enable SSL.',
  },
  {
    pattern: /tenant\/user .*not found/i,
    hint: 'Supavisor did not recognize the pooler tenant/user. Verify the project-specific username and exact regional pooler endpoint.',
  },
  {
    pattern: /no pg_hba\.conf entry/i,
    hint: 'PostgreSQL rejected the client address or connection security mode. Check the network route and SSL requirement.',
  },
  {
    pattern: /self[- ]signed certificate|unable to verify|certificate has expired|hostname\/ip does not match/i,
    hint: 'Database TLS certificate verification failed. Verify the exact pooler hostname and certificate chain.',
  },
];

function isSafeDiagnosticCode(code: string): boolean {
  // OS/libuv codes, Node ERR_* codes, and five-character PostgreSQL SQLSTATEs.
  return /^(?:E[A-Z0-9_]{2,63}|ERR_[A-Z0-9_]{2,59}|[0-9A-Z]{5})$/.test(code);
}

/**
 * Summarize recognized database failures without exposing raw error details.
 * Traversal is bounded and handles cyclic causes and aggregate errors.
 * Unknown standard error codes and known message classes are reported by
 * category so operators can distinguish DNS, routing, TLS and auth failures.
 */
export function databaseFailureDiagnostic(error: unknown): string {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const codes = new Set<string>();
  const unclassifiedCodes = new Set<string>();
  const messageHints = new Set<string>();
  for (let visited = 0; pending.length && visited < 32; visited++) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const detail = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof detail.code === 'string') {
      if (Object.hasOwn(connectionHints, detail.code)) {
        codes.add(detail.code);
      } else if (isSafeDiagnosticCode(detail.code)) {
        unclassifiedCodes.add(detail.code);
      }
    }
    if (typeof detail.message === 'string') {
      for (const item of safeMessageHints) {
        if (item.pattern.test(detail.message)) messageHints.add(item.hint);
      }
    }
    if (detail.cause) pending.push(detail.cause);
    if (Array.isArray(detail.errors))
      pending.push(...detail.errors.slice(0, 16));
  }
  if (codes.size) {
    return [...codes]
      .map((code) => `${code}: ${connectionHints[code]}`)
      .join(' ');
  }
  if (messageHints.size) return [...messageHints].join(' ');
  if (unclassifiedCodes.size) {
    return `Unclassified database connection code(s): ${[...unclassifiedCodes].join(', ')}. Check the endpoint, TLS and credentials. Raw error details are omitted.`;
  }
  return 'Cause unavailable. Check DATABASE_URL, PostgreSQL availability, and database server logs. Raw error details are omitted to protect credentials.';
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
