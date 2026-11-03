/**
 * Resolve the Supabase shared session-pooler URL without exposing or replacing
 * the database password. The caller supplies the exact host copied from the
 * project's Connect dialog.
 */
export function resolveSupabaseSessionPoolerUrl(
  databaseUrl: string,
  poolerHost: string,
  supabaseUrl: string,
): string {
  let connection: URL;
  let projectUrl: URL;

  try {
    connection = new URL(databaseUrl);
    projectUrl = new URL(supabaseUrl);
  } catch {
    throw new Error(
      'Invalid DATABASE_URL or SUPABASE_URL; connection values are not logged.',
    );
  }

  if (
    connection.protocol !== 'postgres:' &&
    connection.protocol !== 'postgresql:'
  ) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }

  if (!connection.username || !connection.password) {
    throw new Error(
      'DATABASE_URL must contain the existing PostgreSQL username and password before session-pooler routing can be enabled.',
    );
  }

  const host = poolerHost.trim().toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/.test(
      host,
    )
  ) {
    throw new Error(
      'SUPABASE_DB_POOLER_HOST must be the exact shared-pooler hostname from Supabase Connect.',
    );
  }

  const projectHostname = projectUrl.hostname.toLowerCase();
  const suffix = '.supabase.co';
  const projectRef = projectHostname.endsWith(suffix)
    ? projectHostname.slice(0, -suffix.length)
    : '';

  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error(
      'SUPABASE_URL must identify a standard Supabase project before session-pooler routing can be enabled.',
    );
  }

  // Keep the configured role and password, but add the project ref required
  // by Supavisor's shared pooler username format.
  const configuredUser = decodeURIComponent(connection.username);
  const role = configuredUser.endsWith(\`.\${projectRef}\`)
    ? configuredUser.slice(0, -(projectRef.length + 1))
    : configuredUser;

  if (!role) {
    throw new Error('DATABASE_URL has no valid PostgreSQL role.');
  }

  connection.hostname = host;
  connection.port = '5432';
  connection.username = \`\${role}.\${projectRef}\`;
  connection.searchParams.set('sslmode', 'require');

  return connection.toString();
}
