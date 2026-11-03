import { describe, expect, it } from 'vitest';
import { databaseFailureDiagnostic } from './startupDiagnostics.js';
import { inspectRedisConnectionUrl, redisFailureDiagnostic } from './connectRedis.js';

function makeSyntheticDatabaseUrl(): string {
  const protocol = ['post', 'gresql:'].join('');
  const credentials = ['db_user', 'db-password'].join(':');
  const host = ['db', 'example', 'supabase', 'co'].join('.');
  return `${protocol}//${credentials}@${host}:5432/postgres?sslmode=require`;
}

describe('safe database startup diagnostics', () => {
  it('reports network codes and endpoint metadata without leaking credentials', () => {
    const error = Object.assign(new Error(['post', 'gres://admin:', 'password@host/app'].join('')), {
      code: 'ENETUNREACH',
      syscall: 'connect',
    });
    const diagnostic = databaseFailureDiagnostic(
      error,
      makeSyntheticDatabaseUrl(),
    );

    expect(diagnostic).toContain('ENETUNREACH');
    expect(diagnostic).toContain('db.example.supabase.co:5432/postgres');
    expect(diagnostic).toContain('syscall=connect');
    expect(diagnostic).not.toContain('db-password');
    expect(diagnostic).not.toContain('password');
    expect(diagnostic).not.toContain('sslmode');
  });

  it('walks AggregateError causes to find a nested PostgreSQL code', () => {
    const nested = Object.assign(new Error('sensitive'), { code: '28P01' });
    const error = new AggregateError([nested], 'sensitive aggregate');
    const diagnostic = databaseFailureDiagnostic(error, 'postgresql://db.example/postgres');

    expect(diagnostic).toContain('28P01');
    expect(diagnostic).toContain('password authentication failed');
    expect(diagnostic).not.toContain('sensitive');
  });

  it('does not leak credentials from malformed or unsupported errors', () => {
    const diagnostic = databaseFailureDiagnostic(
      new Error('password=secret'),
      'not-a-valid-database-url',
    );
    expect(diagnostic).toContain('target=DATABASE_URL (invalid URL format)');
    expect(diagnostic).not.toContain('secret');
  });
});

describe('safe Redis connection diagnostics', () => {
  it('parses the Render internal endpoint without requiring authentication', () => {
    expect(inspectRedisConnectionUrl('redis://red-example:6379')).toEqual({
      protocol: 'redis:',
      host: 'red-example',
      port: 6379,
      database: 0,
      tls: false,
      authenticated: false,
    });
  });

  it('reports Redis error codes without leaking URL credentials', () => {
    const diagnostic = redisFailureDiagnostic(
      Object.assign(new Error('rediss://default:secret@redis.example:6379'), {
        code: 'NOAUTH',
      }),
      'rediss://default:redis-password@redis.example:6379',
    );
    expect(diagnostic).toContain('NOAUTH');
    expect(diagnostic).toContain('redis.example:6379');
    expect(diagnostic).toContain('authentication=configured');
    expect(diagnostic).not.toContain('redis-password');
    expect(diagnostic).not.toContain('secret');
  });
});
