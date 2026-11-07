import { describe, expect, it } from 'vitest';
import { assertProductionDependencies, resolveConnectionUrls } from './startupConfig.js';

const expectedLocalDatabaseUrl = () => {
  const url = new URL('postgresql://localhost:5432/ryanai');
  url.username = 'postgres';
  url.password = 'postgres';
  return url.toString();
};

const supabaseProjectRef = 'narsvpwymvlrhurqbthu';
const supabaseProjectUrl = `https://${supabaseProjectRef}.supabase.co`;
const supabasePoolerHost = 'aws-1-eu-west-1.pooler.supabase.com';

function supabaseDatabaseUrl(host: string, password = 'test-placeholder'): string {
  const url = new URL('postgresql://localhost:5432/postgres');
  url.hostname = host;
  url.username = 'postgres';
  url.password = password;
  return url.toString();
}

describe('production connection configuration', () => {
  it('fails closed when production database and Redis URLs are missing', () => {
    expect(() => resolveConnectionUrls('production')).toThrow(
      'DATABASE_URL, REDIS_URL',
    );
  });

  it('identifies only the missing production variable', () => {
    expect(() => resolveConnectionUrls('production', 'postgresql://db/app')).toThrow(
      'REDIS_URL',
    );
    expect(() => resolveConnectionUrls('production', undefined, 'redis://cache')).toThrow(
      'DATABASE_URL',
    );
  });

  it('accepts explicitly configured production URLs', () => {
    expect(
      resolveConnectionUrls(
        'production',
        'postgresql://db/app',
        'redis://cache/0',
      ),
    ).toEqual({
      databaseUrl: 'postgresql://db/app',
      redisUrl: 'redis://cache/0',
    });
  });

  it('routes a Supabase direct connection through the configured IPv4 Session Pooler', () => {
    const result = resolveConnectionUrls(
      'production',
      supabaseDatabaseUrl(`db.${supabaseProjectRef}.supabase.co`, 'p@ss:word'),
      'redis://cache',
      supabaseProjectUrl,
      supabasePoolerHost,
      '/etc/ssl/supabase-root.crt',
    );
    const database = new URL(result.databaseUrl);

    expect(database.hostname).toBe(supabasePoolerHost);
    expect(database.port).toBe('5432');
    expect(database.username).toBe(`postgres.${supabaseProjectRef}`);
    expect(database.password).toBe('p%40ss%3Aword');
    expect(database.searchParams.get('sslmode')).toBe('verify-full');
    expect(database.searchParams.get('sslrootcert')).toBe('/etc/ssl/supabase-root.crt');
    expect(database.searchParams.get('sslaccept')).toBe('strict');
  });

  it('repairs an existing Supabase pooler URL with an unqualified username', () => {
    const result = resolveConnectionUrls(
      'production',
      supabaseDatabaseUrl(supabasePoolerHost),
      'redis://cache',
      supabaseProjectUrl,
      supabasePoolerHost,
    );
    const database = new URL(result.databaseUrl);

    expect(database.hostname).toBe(supabasePoolerHost);
    expect(database.username).toBe(`postgres.${supabaseProjectRef}`);
    expect(database.searchParams.get('sslmode')).toBe('verify-full');
  });

  it('rejects Supabase pooler routing when its project or verified host is missing', () => {
    expect(() => resolveConnectionUrls(
      'production',
      `postgresql://postgres:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`,
      'redis://cache',
      supabaseProjectUrl,
    )).toThrow('SUPABASE_SESSION_POOLER_HOST');
  });

  it('retains local defaults outside production', () => {
    expect(resolveConnectionUrls('development')).toEqual({
      databaseUrl: expectedLocalDatabaseUrl(),
      redisUrl: 'redis://localhost:6379',
    });
    expect(resolveConnectionUrls('test')).toEqual({
      databaseUrl: expectedLocalDatabaseUrl(),
      redisUrl: 'redis://localhost:6379',
    });
  });

  it('does not treat whitespace-only values as configured', () => {
    expect(() => resolveConnectionUrls('production', '  ', 'redis://cache')).toThrow(
      'DATABASE_URL',
    );
  });
});

describe('production startup dependency gate', () => {
  it('blocks production startup when PostgreSQL is unavailable', () => {
    expect(() =>
      assertProductionDependencies('production', { database: false, redis: true, agentCheckpointer: true }),
    ).toThrow('PostgreSQL');
  });

  it('blocks production startup when Redis is unavailable', () => {
    expect(() =>
      assertProductionDependencies('production', { database: true, redis: false, agentCheckpointer: true }),
    ).toThrow('Redis');
  });

  it('allows production startup only when both dependencies are ready', () => {
    expect(() =>
      assertProductionDependencies('production', { database: true, redis: true, agentCheckpointer: true }),
    ).not.toThrow();
  });

  it('keeps non-production degraded startup behavior unchanged', () => {
    expect(() =>
      assertProductionDependencies('development', { database: false, redis: false, agentCheckpointer: false }),
    ).not.toThrow();
    expect(() =>
      assertProductionDependencies('test', { database: false, redis: false, agentCheckpointer: false }),
    ).not.toThrow();
  });
});

describe('production agent checkpointer readiness', () => {
  it('blocks production startup when the agent checkpointer is unavailable', () => {
    expect(() =>
      assertProductionDependencies('production', {
        database: true,
        redis: true,
        agentCheckpointer: false,
      }),
    ).toThrow('agent checkpointer');
  });
});
