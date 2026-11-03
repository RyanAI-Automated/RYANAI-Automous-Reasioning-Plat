import { describe, expect, it } from 'vitest';
import {
  assertSameDatabaseBackend,
  describeDatabaseBackend,
  resolveDatabaseConnectionUrl,
} from './databaseConnection.js';

describe('shared PostgreSQL connection contract', () => {
  it('requires an explicit database URL in production', () => {
    expect(() => resolveDatabaseConnectionUrl('production')).toThrow('DATABASE_URL');
  });

  it('keeps local defaults limited to non-production environments', () => {
    expect(resolveDatabaseConnectionUrl('test')).toBe(
      'postgresql://postgres:postgres@localhost:5432/ryanai',
    );
  });

  it('describes backend identity without returning credentials or arbitrary query values', () => {
    const identity = describeDatabaseBackend(
      'postgresql://private-user:private-password@DB.Example:5433/ryanai?sslmode=require&token=must-not-appear',
    );

    expect(identity).toEqual({
      protocol: 'postgresql',
      host: 'db.example',
      port: 5433,
      database: 'ryanai',
      sslMode: 'require',
    });
    expect(JSON.stringify(identity)).not.toMatch(/private-user|private-password|must-not-appear/);
  });

  it('accepts API and checkpointer URLs targeting the same backend even when credentials differ', () => {
    expect(() =>
      assertSameDatabaseBackend(
        'postgresql://api-user:api-secret@db.example:5432/ryanai?sslmode=require',
        'postgresql://graph-user:graph-secret@DB.EXAMPLE/ryanai?sslmode=require',
      ),
    ).not.toThrow();
  });

  it('rejects API and checkpointer URLs targeting different backends', () => {
    expect(() =>
      assertSameDatabaseBackend(
        'postgresql://api-user:api-secret@db.example:5432/ryanai',
        'postgresql://graph-user:graph-secret@other.example:5432/ryanai',
      ),
    ).toThrow('Database backend mismatch');
  });

  it('rejects non-PostgreSQL URLs', () => {
    expect(() => describeDatabaseBackend('mysql://db.example/ryanai')).toThrow(
      'PostgreSQL',
    );
  });
});
