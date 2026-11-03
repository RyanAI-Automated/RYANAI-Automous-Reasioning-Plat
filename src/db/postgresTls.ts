import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPABASE_ROOT_CA_SHA256 =
  '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
const SUPABASE_ROOT_CA_PATH = resolve(
  process.cwd(),
  'prisma',
  'certs',
  'supabase-root-ca-2021.crt',
);

function isSupabasePostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid PostgreSQL connection URL; value omitted.');
  }
  return (
    parsed.protocol === 'postgres:' ||
    parsed.protocol === 'postgresql:'
  ) && (
    parsed.hostname.endsWith('.supabase.co') ||
    parsed.hostname.endsWith('.pooler.supabase.com')
  );
}

/** Load and pin the public Supabase CA before trusting it for database TLS. */
export function loadSupabaseRootCa(): string {
  let pem: string;
  try {
    pem = readFileSync(SUPABASE_ROOT_CA_PATH, 'utf8');
    const certificate = new X509Certificate(pem);
    const fingerprint = createHash('sha256')
      .update(certificate.raw)
      .digest('hex');
    if (fingerprint !== SUPABASE_ROOT_CA_SHA256) {
      throw new Error('Supabase database CA fingerprint mismatch.');
    }
    if (Date.parse(certificate.validTo) <= Date.now()) {
      throw new Error('Supabase database CA certificate has expired.');
    }
    if (!certificate.subject.includes('CN=Supabase Root 2021 CA')) {
      throw new Error('Unexpected Supabase database CA subject.');
    }
    return pem;
  } catch (error) {
    if (error instanceof Error && /fingerprint|expired|subject/.test(error.message)) {
      throw error;
    }
    throw new Error('Supabase database CA is missing or invalid; TLS startup is blocked.');
  }
}

/**
 * pg-connection-string replaces an explicit ssl object when SSL URL parameters
 * are present. Remove those parameters and supply a pinned CA with hostname
 * verification enabled instead.
 */
export function postgresClientOptions(connectionString: string) {
  if (!isSupabasePostgresUrl(connectionString)) {
    return { connectionString };
  }

  const url = new URL(connectionString);
  for (const key of [
    'sslmode',
    'sslrootcert',
    'sslcert',
    'sslkey',
    'sslpassword',
    'sslidentity',
    'sslaccept',
    'uselibpqcompat',
  ]) {
    url.searchParams.delete(key);
  }

  return {
    connectionString: url.toString(),
    ssl: {
      ca: loadSupabaseRootCa(),
      rejectUnauthorized: true,
    },
  };
}

/** Prisma 6 uses sslcert for the server CA path and sslaccept=strict. */
export function prismaTlsOptions(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl || !isSupabasePostgresUrl(databaseUrl)) return {};

  // Validate the bundled trust anchor before Prisma is allowed to connect.
  loadSupabaseRootCa();
  const url = new URL(databaseUrl);
  for (const key of [
    'sslmode',
    'sslrootcert',
    'sslcert',
    'sslkey',
    'sslpassword',
    'sslidentity',
    'sslaccept',
    'uselibpqcompat',
  ]) {
    url.searchParams.delete(key);
  }
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  // Prisma resolves this path relative to the prisma/ directory.
  url.searchParams.set('sslcert', 'certs/supabase-root-ca-2021.crt');
  return { datasources: { db: { url: url.toString() } } };
}
