import { describe, expect, it } from 'vitest';
import { resolveSupabaseSessionPoolerUrl } from './supabasePooler.js';

const projectRef = 'narsvpwymvlrhurqbthu';
const projectUrl = `https://${projectRef}.supabase.co`;
const directHost = `db.${projectRef}.supabase.co`;
const poolerHost = 'aws-1-eu-west-1.pooler.supabase.com';

describe('Supabase Session Pooler URL resolution', () => {
  it('rewrites only the Supabase direct route and preserves the encoded password', () => {
    const result = resolveSupabaseSessionPoolerUrl(
      `postgresql://postgres:p%40ss%3Aword@${directHost}:5432/postgres?application_name=ryanai`,
      projectUrl,
      poolerHost,
    );

    expect(result.changed).toBe(true);
    expect(result.reason).toBe('rewritten');
    const url = new URL(result.databaseUrl!);
    expect(url.hostname).toBe(poolerHost);
    expect(url.port).toBe('5432');
    expect(url.username).toBe(`postgres.${projectRef}`);
    expect(url.password).toBe('p%40ss%3Aword');
    expect(url.pathname).toBe('/postgres');
    expect(url.searchParams.get('application_name')).toBe('ryanai');
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
  });

  it('preserves a verified TLS mode', () => {
    const result = resolveSupabaseSessionPoolerUrl(
      `postgresql://postgres:secret@${directHost}:5432/postgres?sslmode=verify-full`,
      projectUrl,
      poolerHost,
    );

    expect(new URL(result.databaseUrl!).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('overrides an explicitly disabled TLS mode with verified TLS', () => {
    const result = resolveSupabaseSessionPoolerUrl(
      `postgresql://postgres:secret@${directHost}:5432/postgres?sslmode=disable`,
      projectUrl,
      poolerHost,
    );

    expect(new URL(result.databaseUrl!).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('normalizes an existing Supabase pooler URL to the verified configured host', () => {
    const oldPoolerHost = 'aws-0-eu-central-1.pooler.supabase.com';
    const existing = `postgresql://postgres.${projectRef}:secret@${oldPoolerHost}:6543/postgres?sslmode=require`;
    const result = resolveSupabaseSessionPoolerUrl(existing, projectUrl, poolerHost);

    expect(result.changed).toBe(true);
    expect(result.reason).toBe('rewritten');
    const url = new URL(result.databaseUrl!);
    expect(url.hostname).toBe(poolerHost);
    expect(url.port).toBe('5432');
    expect(url.username).toBe(`postgres.${projectRef}`);
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.password).toBe('secret');
  });

  it('repairs an existing pooler URL with an unqualified username and missing TLS mode', () => {
    const existing = `postgresql://postgres:secret@${poolerHost}:5432/postgres`;
    const result = resolveSupabaseSessionPoolerUrl(existing, projectUrl, poolerHost);

    expect(result.changed).toBe(true);
    expect(result.reason).toBe('rewritten');
    const url = new URL(result.databaseUrl!);
    expect(url.hostname).toBe(poolerHost);
    expect(url.username).toBe(`postgres.${projectRef}`);
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
  });

  it('pins the Supabase root CA for Prisma and node-postgres with strict certificate validation', () => {
    const rootCertPath = '/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt';
    const existing = `postgresql://postgres.${projectRef}:secret@${poolerHost}:5432/postgres?application_name=ryanai`;
    const result = resolveSupabaseSessionPoolerUrl(existing, projectUrl, poolerHost, rootCertPath);

    expect(result.changed).toBe(true);
    const url = new URL(result.databaseUrl!);
    expect(url.hostname).toBe(poolerHost);
    expect(url.username).toBe(`postgres.${projectRef}`);
    expect(url.password).toBe('secret');
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.searchParams.get('sslrootcert')).toBe(rootCertPath);
    expect(url.searchParams.get('sslaccept')).toBe('strict');
    expect(url.searchParams.get('application_name')).toBe('ryanai');
  });

  it('repairs an existing pooled URL with an obsolete CA path', () => {
    const rootCertPath = '/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt';
    const existing = `postgresql://postgres.${projectRef}:secret@${poolerHost}:5432/postgres?sslmode=verify-full&sslrootcert=/tmp/old-ca.crt`;
    const result = resolveSupabaseSessionPoolerUrl(existing, projectUrl, poolerHost, rootCertPath);

    const url = new URL(result.databaseUrl!);
    expect(url.searchParams.get('sslrootcert')).toBe(rootCertPath);
    expect(url.searchParams.get('sslaccept')).toBe('strict');
  });

  it('does not rewrite a connection that is already using the verified pooler configuration', () => {
    const existing = `postgresql://postgres.${projectRef}:secret@${poolerHost}:5432/postgres?sslmode=verify-full`;
    const result = resolveSupabaseSessionPoolerUrl(existing, projectUrl, poolerHost);

    expect(result).toEqual({
      databaseUrl: existing,
      changed: false,
      reason: 'already-pooled',
    });
  });

  it('does not rewrite a different database provider', () => {
    const existing = 'postgresql://app:secret@db.example.com:5432/app';
    const result = resolveSupabaseSessionPoolerUrl(existing, projectUrl, poolerHost);

    expect(result.databaseUrl).toBe(existing);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('not-supabase-direct');
  });

  it('does not create a credential when the password is absent', () => {
    const existing = `postgresql://postgres@${directHost}:5432/postgres`;
    const result = resolveSupabaseSessionPoolerUrl(existing, projectUrl, poolerHost);

    expect(result.databaseUrl).toBe(existing);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('missing-password');
  });

  it('leaves configuration untouched when the pooler host is invalid', () => {
    const existing = `postgresql://postgres:secret@${directHost}:5432/postgres`;
    const result = resolveSupabaseSessionPoolerUrl(existing, projectUrl, 'not-a-pooler.example.com');

    expect(result.databaseUrl).toBe(existing);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('invalid-pooler-host');
  });
});
