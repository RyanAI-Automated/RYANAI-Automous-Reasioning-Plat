import { describe, expect, it } from 'vitest';
import { resolveConnectionUrls } from './startupConfig.js';

const expectedLocalDatabaseUrl = () => {
  const url = new URL('postgresql://localhost:5432/ryanai');
  url.username = 'postgres';
  url.password = 'postgres';
  return url.toString();
};

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
