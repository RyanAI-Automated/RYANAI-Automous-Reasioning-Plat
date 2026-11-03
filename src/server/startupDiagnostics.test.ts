import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import pg from 'pg';
import {
  databaseConnectionTarget,
  databaseFailureDiagnostic,
  startupSummary,
} from './startupDiagnostics.js';

const ready = {
  database: true,
  redis: true,
  agentCheckpointer: true,
  api: true,
};

describe('startup readiness reporting', () => {
  it('reports readiness only when every startup service succeeded', () => {
    expect(startupSummary(ready)).toBe('🟢 All services ready!');
  });

  it.each(['database', 'redis', 'agentCheckpointer', 'api'] as const)(
    'identifies failed %s initialization without claiming readiness',
    (service) => {
      const result = startupSummary({ ...ready, [service]: false });
      expect(result).toContain('Startup degraded');
      expect(result).toContain(service);
      expect(result).not.toContain('All services ready');
    },
  );

  it('lists multiple failures together', () => {
    expect(
      startupSummary({ ...ready, database: false, agentCheckpointer: false }),
    ).toContain('database, agentCheckpointer');
  });
});

describe('safe database connection target reporting', () => {
  it('reports the PostgreSQL host and default port without credentials or path', () => {
    expect(
      databaseConnectionTarget(
        'postgresql://private-user:private-password@db.example.com/private-db?sslmode=require', // trufflehog:ignore
      ),
    ).toBe('db.example.com:5432');
  });

  it('reports a configured non-PostgreSQL URL as an invalid protocol without exposing secrets', () => {
    const target = databaseConnectionTarget(
      'https://private-user:private-password@api.example.com/private-path?token=private-token',
    );
    expect(target).toBe('api.example.com:443 (unexpected protocol https:)');
    expect(target).not.toContain('private');
    expect(target).not.toContain('token');
  });

  it('reports an explicit session-pooler port', () => {
    expect(
      databaseConnectionTarget(
        'postgres://postgres.project-ref:private-password@pooler.example.com:5432/postgres', // trufflehog:ignore
      ),
    ).toBe('pooler.example.com:5432');
  });

  it('does not echo malformed connection strings', () => {
    expect(databaseConnectionTarget('not-a-database-url')).toBe(
      'unparseable DATABASE_URL',
    );
  });
});

describe('safe database diagnostics', () => {
  it('extracts the cause of an empty-message aggregate error', () => {
    const error = new AggregateError(
      [
        Object.assign(new Error('private connection details'), {
          code: 'ECONNREFUSED',
        }),
        Object.assign(new Error('more private details'), {
          code: 'ECONNREFUSED',
        }),
      ],
      '',
    );
    const result = databaseFailureDiagnostic(error);
    expect(result).toContain('ECONNREFUSED: Connection refused');
    expect(result.match(/ECONNREFUSED/g)).toHaveLength(1);
    expect(result).not.toContain('private');
  });

  it.each([
    ['28P01', 'Password authentication failed'],
    ['ENOTFOUND', 'hostname could not be resolved'],
    ['EHOSTUNREACH', 'host is unreachable'],
    ['ENETUNREACH', 'network is unreachable'],
    ['ERR_INVALID_URL', 'not a valid PostgreSQL connection URL'],
    ['3D000', 'database does not exist'],
    ['ETIMEDOUT', 'Connection timed out'],
  ])('provides actionable guidance for %s', (code, hint) => {
    expect(
      databaseFailureDiagnostic(new Error('', { cause: { code } })),
    ).toContain(hint);
  });

  it.each([
    undefined,
    null,
    'postgresql://user:secret@db/private', // trufflehog:ignore
    { code: 'secret', message: 'secret', detail: 'secret', stack: 'secret' },
    new Error('postgresql://user:secret@db/private'), // trufflehog:ignore
  ])(
    'keeps unknown failures useful without disclosing raw details',
    (error) => {
      const result = databaseFailureDiagnostic(error);
      expect(result).toContain('Cause unavailable');
      expect(result).toContain('DATABASE_URL');
      expect(result).not.toContain('secret');
    },
  );

  it('terminates when causes form a cycle', () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(databaseFailureDiagnostic(error)).toContain('Cause unavailable');
  });

  it('explains an actual refused pg connection without credentials', async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing address');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const pool = new pg.Pool({
      connectionString: `postgresql://fixture:private-password@127.0.0.1:${address.port}/fixture`, // trufflehog:ignore
      connectionTimeoutMillis: 1000,
    });
    try {
      let failure: unknown;
      try {
        await pool.query('SELECT NOW()');
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeDefined();
      const result = databaseFailureDiagnostic(failure);
      expect(result).toContain('ECONNREFUSED');
      expect(result).not.toContain('private-password');
    } finally {
      await pool.end();
    }
  });
});
