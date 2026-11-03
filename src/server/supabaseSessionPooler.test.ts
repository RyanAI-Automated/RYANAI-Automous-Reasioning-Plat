import { describe, expect, it } from 'vitest';
import { resolveSupabaseSessionPoolerUrl } from './supabaseSessionPooler.js';

const projectUrl = 'https://narsvpwymvlrhurqbthu.supabase.co';
const poolerHost = 'aws-1-eu-west-1.pooler.supabase.com';

describe('resolveSupabaseSessionPoolerUrl', () => {
  it('routes a direct connection through the supplied session pooler and keeps its password', () => {
    const result = resolveSupabaseSessionPoolerUrl(
      'postgresql://postgres:p%40ss%23word@db.narsvpwymvlrhurqbthu.supabase.co:5432/postgres', // trufflehog:ignore
      poolerHost,
      projectUrl,
    );
    const parsed = new URL(result);

    expect(parsed.hostname).toBe(poolerHost);
    expect(parsed.port).toBe('5432');
    expect(parsed.username).toBe('postgres.narsvpwymvlrhurqbthu');
    expect(parsed.password).toBe('p%40ss%23word');
    expect(parsed.pathname).toBe('/postgres');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
  });

  it('does not duplicate the project ref in an already qualified pooler username', () => {
    const result = resolveSupabaseSessionPoolerUrl(
      'postgresql://postgres.narsvpwymvlrhurqbthu:secret@old.pooler.supabase.com:5432/postgres?sslmode=prefer', // trufflehog:ignore
      poolerHost,
      projectUrl,
    );
    const parsed = new URL(result);

    expect(parsed.username).toBe('postgres.narsvpwymvlrhurqbthu');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
  });

  it('rejects a missing password rather than creating an unauthenticated URL', () => {
    expect(() =>
      resolveSupabaseSessionPoolerUrl(
        'postgresql://postgres@db.narsvpwymvlrhurqbthu.supabase.co:5432/postgres', // trufflehog:ignore
        poolerHost,
        projectUrl,
      ),
    ).toThrow(/existing PostgreSQL username and password/);
  });

  it('rejects a host that is not a Supabase shared-pooler hostname', () => {
    expect(() =>
      resolveSupabaseSessionPoolerUrl(
        'postgresql://postgres:secret@db.narsvpwymvlrhurqbthu.supabase.co:5432/postgres', // trufflehog:ignore
        'aws-1-eu-west-1.pooler.example.com',
        projectUrl,
      ),
    ).toThrow(/exact shared-pooler hostname/);
  });

  it('rejects a project URL that does not identify the expected Supabase project format', () => {
    expect(() =>
      resolveSupabaseSessionPoolerUrl(
        'postgresql://postgres:secret@db.example.com:5432/postgres', // trufflehog:ignore
        poolerHost,
        'https://example.com',
      ),
    ).toThrow(/standard Supabase project/);
  });
});
