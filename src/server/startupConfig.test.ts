import { describe, expect, it } from 'vitest';
import { resolveConnectionUrls } from './startupConfig.js';

describe('production connection configuration', () => {
  it('fails closed when production database and Redis URLs are missing', () => {
    expect(() => resolveConnectionUrls('production')).toThrow(
      'DATABASE_URL, REDIS_URL',
    );
  });

  it('identifies only the missing production variable', () => {
    expect(() => resolveConnectionUrls('production', 'postgresql://db')).toThrow(
      'REDIS_URL',
    );
    expect(() => resolveConnectionUrls('production', undefined, 'redis://cache')).toThrow(
      'DATABASE_URL',
    );
  });

  it('accepts explicitly configured production URLs without echoing them', () => {
    expect(
      resolveConnectionUrls(
        'production',
        'postgresql://user:secret@db/app',
        'redis://:secret@cache/0',
      ),
    ).toEqual({
      databaseUrl: 'postgresql://user:secret@db/app',
      redisUrl: 'redis://:secret@cache/0',
    });
  });

  it('retains local defaults outside production', () => {
    expect(resolveConnectionUrls('development')).toEqual({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/ryanai',
      redisUrl: 'redis://localhost:6379',
    });
    expect(resolveConnectionUrls('test')).toEqual({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/ryanai',
      redisUrl: 'redis://localhost:6379',
    });
  });

  it('does not treat whitespace-only values as configured', () => {
    expect(() => resolveConnectionUrls('production', '  ', 'redis://cache')).toThrow(
      'DATABASE_URL',
    );
  });
});
