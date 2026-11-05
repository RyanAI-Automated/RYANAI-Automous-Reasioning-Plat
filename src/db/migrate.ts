/**
 * Apply committed Prisma migrations explicitly.
 *
 * Application startup must only verify schema readiness; it must never use
 * prisma db push or run schema DDL implicitly.
 *
 * Production migrations are run only by the protected, manually dispatched
 * workflow. The URL is normalized to the operator-confirmed Supabase Session
 * Pooler host and pinned to the bundled CA with full certificate verification.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSupabaseSessionPoolerUrl } from '../server/supabasePooler.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to apply committed Prisma migrations.');
}

if (process.env.NODE_ENV === 'production') {
  const rootCertPath = process.env.SUPABASE_SSL_ROOT_CERT_PATH?.trim();
  if (!rootCertPath) {
    throw new Error('Production migrations require the verified Supabase root CA path.');
  }

  try {
    accessSync(rootCertPath, constants.R_OK);
  } catch {
    throw new Error('Production migrations cannot read the configured Supabase root CA certificate.');
  }

  const resolution = resolveSupabaseSessionPoolerUrl(
    databaseUrl,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SESSION_POOLER_HOST,
    rootCertPath,
  );

  if (
    !resolution.databaseUrl
    || !['rewritten', 'already-pooled'].includes(resolution.reason)
  ) {
    throw new Error(
      `Production migration database URL validation failed (${resolution.reason}); refusing to run.`,
    );
  }

  const resolvedUrl = new URL(resolution.databaseUrl);
  if (
    resolvedUrl.searchParams.get('sslmode') !== 'verify-full'
    || resolvedUrl.searchParams.get('sslrootcert') !== rootCertPath
    || resolvedUrl.searchParams.get('sslaccept') !== 'strict'
  ) {
    throw new Error('Production migration database URL does not enforce verified Supabase TLS.');
  }

  // Never print or otherwise expose the connection URL.
  process.env.DATABASE_URL = resolution.databaseUrl;
}

const prismaCli = resolve(
  process.cwd(),
  'node_modules',
  'prisma',
  'build',
  'index.js',
);

const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: false,
});

child.on('error', (error) => {
  console.error('Failed to start Prisma migration deployment:', error.message);
  process.exitCode = 1;
});

child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
