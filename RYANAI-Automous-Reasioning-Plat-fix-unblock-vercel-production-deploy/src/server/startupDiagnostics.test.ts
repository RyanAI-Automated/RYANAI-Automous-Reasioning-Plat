import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import pg from 'pg';
import {
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
    'postgresql://user:secret@db/private',
    { code: 'secret', message: 'secret', detail: 'secret', stack: 'secret' },
    new Error('postgresql://user:secret@db/private'),
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
      connectionString: `postgresql://fixture:private-password@127.0.0.1:${address.port}/fixture`,
      connectionTimeoutMillis: 1000,
    });
    try {
      await expect(pool.query('SELECT NOW()')).rejects.toSatisfy(
        (error: unknown) => {
          const result = databaseFailureDiagnostic(error);
          return (
            result.includes('ECONNREFUSED') &&
            !result.includes('private-password')
          );
        },
      );
    } finally {
      await pool.end();
    }
  });
});
