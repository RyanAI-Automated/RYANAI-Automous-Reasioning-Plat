export interface SupabasePoolerResolution {
  databaseUrl: string | undefined;
  changed: boolean;
  reason:
    | 'rewritten'
    | 'missing-configuration'
    | 'missing-password'
    | 'already-pooled'
    | 'not-supabase-direct'
    | 'invalid-url'
    | 'invalid-pooler-host';
}

/**
 * Adapt a Supabase direct URL to the Shared Pooler Session endpoint when a
 * persistent production service runs on an IPv4-only network.
 *
 * Only connection routing is changed. The existing password remains in the
 * URL in memory and is never returned in diagnostics or logged.
 */
export function resolveSupabaseSessionPoolerUrl(
  databaseUrl: string | undefined,
  supabaseUrl: string | undefined,
  poolerHost: string | undefined,
): SupabasePoolerResolution {
  const original = databaseUrl?.trim();
  if (!original || !supabaseUrl?.trim() || !poolerHost?.trim()) {
    return {
      databaseUrl: original,
      changed: false,
      reason: 'missing-configuration',
    };
  }

  let database: URL;
  let project: URL;
  try {
    database = new URL(original);
    project = new URL(supabaseUrl.trim());
  } catch {
    return { databaseUrl: original, changed: false, reason: 'invalid-url' };
  }

  if (database.protocol !== 'postgres:' && database.protocol !== 'postgresql:') {
    return { databaseUrl: original, changed: false, reason: 'invalid-url' };
  }

  const projectMatch = project.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
  if (project.protocol !== 'https:' || !projectMatch) {
    return { databaseUrl: original, changed: false, reason: 'invalid-url' };
  }

  const projectRef = projectMatch[1].toLowerCase();
  const directHost = `db.${projectRef}.supabase.co`;
  const normalizedPoolerHost = poolerHost.trim().toLowerCase();

  if (database.hostname.toLowerCase() !== directHost) {
    const alreadyPooled = database.hostname.toLowerCase() === normalizedPoolerHost;
    return {
      databaseUrl: original,
      changed: false,
      reason: alreadyPooled ? 'already-pooled' : 'not-supabase-direct',
    };
  }

  if (!database.password) {
    return { databaseUrl: original, changed: false, reason: 'missing-password' };
  }

  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(normalizedPoolerHost)) {
    return { databaseUrl: original, changed: false, reason: 'invalid-pooler-host' };
  }

  database.hostname = normalizedPoolerHost;
  database.port = '5432';
  database.username = `postgres.${projectRef}`;
  const sslMode = database.searchParams.get('sslmode')?.toLowerCase();
  if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    database.searchParams.set('sslmode', 'require');
  }

  return {
    databaseUrl: database.toString(),
    changed: true,
    reason: 'rewritten',
  };
}
