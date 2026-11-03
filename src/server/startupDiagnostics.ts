const connectionHints: Record<string, string> = {
  ECONNREFUSED: 'Connection refused. Check the PostgreSQL host and port.',
  ENETUNREACH: 'The API runtime has no route to the PostgreSQL network. Check network reachability and the selected endpoint.',
  EHOSTUNREACH: 'The PostgreSQL host is unreachable from the API runtime.',
  ENOTFOUND: 'The PostgreSQL hostname could not be resolved. Check the host in DATABASE_URL.',
  EAI_AGAIN: 'PostgreSQL hostname lookup temporarily failed. Check DNS and retry.',
  ETIMEDOUT: 'The PostgreSQL connection timed out. Check reachability, firewall rules and pooler status.',
  ECONNRESET: 'The PostgreSQL connection was reset. Check database availability and TLS settings.',
  EADDRNOTAVAIL: 'The runtime could not allocate a local network address for PostgreSQL.',
  ECONNABORTED: 'The PostgreSQL connection was aborted.',
  EPIPE: 'The PostgreSQL connection closed while data was being sent.',
  '08001': 'The client could not establish a PostgreSQL connection. Check host, port and network path.',
  '08004': 'The PostgreSQL server rejected the connection.',
  '08006': 'The PostgreSQL connection failed after being established.',
  '28P01': 'PostgreSQL password authentication failed. Check the database credentials in DATABASE_URL.',
  '28000': 'PostgreSQL authorization failed. Check the database user and server access rules.',
  '3D000': 'The configured PostgreSQL database does not exist. Check the database name.',
  '53300': 'PostgreSQL has too many connections. Check the project connection limit and pool sizing.',
  '57P03': 'PostgreSQL is not accepting connections yet. Check server readiness and retry.',
  'ERR_TLS_CERT_ALTNAME_INVALID': 'TLS certificate hostname validation failed. Use the official Supabase connection string and TLS settings.',
  'CERT_HAS_EXPIRED': 'The PostgreSQL TLS certificate has expired.',
  'DEPTH_ZERO_SELF_SIGNED_CERT': 'The PostgreSQL TLS certificate is not trusted by the runtime.',
};

function safePostgresTarget(connectionUrl?: string): string {
  if (!connectionUrl) return 'target=DATABASE_URL (not provided)';
  try {
    const parsed = new URL(connectionUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return 'target=DATABASE_URL (not a PostgreSQL URL)';
    }
    const path = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
    const database = path.replace(/[^a-zA-Z0-9_.-]/g, '');
    return `target=${parsed.hostname}:${parsed.port || '5432'}/${database || '(default)'}`;
  } catch {
    return 'target=DATABASE_URL (invalid URL format)';
  }
}

/**
 * Report only allow-listed error metadata and the non-secret database endpoint.
 * Never log connection URLs, usernames, passwords, query parameters, or raw messages.
 * Traversal is bounded and handles nested causes and AggregateError instances.
 */
export function databaseFailureDiagnostic(error: unknown, connectionUrl?: string): string {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const codes = new Set<string>();
  const types = new Set<string>();
  const syscalls = new Set<string>();

  for (let visited = 0; pending.length && visited < 32; visited++) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const detail = current as {
      name?: unknown;
      code?: unknown;
      syscall?: unknown;
      cause?: unknown;
      errors?: unknown;
    };

    if (typeof detail.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(detail.name)) {
      types.add(detail.name);
    }
    if (typeof detail.code === 'string' && /^[A-Z0-9_]{2,64}$/.test(detail.code)) {
      codes.add(detail.code);
    }
    if (typeof detail.syscall === 'string' && /^[a-zA-Z0-9_]{2,32}$/.test(detail.syscall)) {
      syscalls.add(detail.syscall);
    }
    if (detail.cause) pending.push(detail.cause);
    if (Array.isArray(detail.errors)) pending.push(...detail.errors.slice(0, 16));
  }

  const typeSummary = types.size ? `type=${[...types].join(',')}` : 'type=unknown';
  const codeSummary = codes.size ? `code=${[...codes].join(',')}` : 'code=not-exposed';
  const syscallSummary = syscalls.size ? `syscall=${[...syscalls].join(',')}` : '';
  const hints = [...codes]
    .map((code) => connectionHints[code] ?? 'Check PostgreSQL connection details, credentials, network reachability and server logs.')
    .join(' ');

  return [
    'PostgreSQL connection failed:',
    typeSummary,
    codeSummary,
    syscallSummary,
    safePostgresTarget(connectionUrl),
    hints || 'No recognized connection code was exposed. Check the Supabase Connect string and database logs.',
    'Credentials and raw error messages are omitted.',
  ].filter(Boolean).join(' ');
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
