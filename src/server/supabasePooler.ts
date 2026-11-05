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
 * Normalize a Supabase direct or shared-pooler URL to the explicitly configured
 * Shared Pooler Session endpoint for this project.
 *
 * This also repairs existing pooler URLs: a previous region-derived hostname,
 * an unqualified postgres username, or a missing/weak sslmode must not survive
 * once the operator supplies the verified Connect-dialog hostname.
 *
 * Only connection routing is changed. The existing password remains in the
 * URL in memory and is never returned in diagnostics or logged.
 */
export function resolveSupabaseSessionPoolerUrl(
  databaseUrl: string | undefined,
  supabaseUrl: string | undefined,
  poolerHost: string | undefined,
  sslRootCertPath?: string,
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
  const currentHost = database.hostname.toLowerCase();
  const normalizedPoolerHost = poolerHost.trim().toLowerCase();
  const isSupabaseDirect = currentHost === directHost;
  const isSupabaseSharedPooler = currentHost.endsWith('.pooler.supabase.com');

  if (!isSupabaseDirect && !isSupabaseSharedPooler) {
    return {
      databaseUrl: original,
      changed: false,
      reason: 'not-supabase-direct',
    };
  }

  if (!database.password) {
    return { databaseUrl: original, changed: false, reason: 'missing-password' };
  }

  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(normalizedPoolerHost)) {
    return { databaseUrl: original, changed: false, reason: 'invalid-pooler-host' };
  }

  // Shared-pooler usernames must include the project reference. Preserve a
  // custom role name if supplied; otherwise qualify the default postgres role.
  let currentUsername: string;
  try {
    currentUsername = decodeURIComponent(database.username);
  } catch {
    return { databaseUrl: original, changed: false, reason: 'invalid-url' };
  }
  const role = currentUsername.split('.')[0] || 'postgres';

  database.hostname = normalizedPoolerHost;
  database.port = '5432';
  database.username = `${role}.${projectRef}`;
  // Require full certificate/hostname verification for both newly-routed and
  // previously-pooled URLs; do not retain require, disable, or verify-ca.
  database.searchParams.set('sslmode', 'verify-full');
  const configuredRootCert = sslRootCertPath?.trim() || database.searchParams.get('sslrootcert');
  if (configuredRootCert) {
    // Prisma 6 defaults sslaccept to accepting invalid certificates. The
    // Supabase CA path is also consumed by node-postgres (pg-connection-string).
    database.searchParams.set('sslrootcert', configuredRootCert);
    database.searchParams.set('sslaccept', 'strict');
  }

  const normalized = database.toString();
  const changed = normalized !== original;
  return {
    databaseUrl: changed ? normalized : original,
    changed,
    reason: changed ? 'rewritten' : 'already-pooled',
  };
}
