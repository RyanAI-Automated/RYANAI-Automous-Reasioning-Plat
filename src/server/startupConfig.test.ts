import { describe, expect, it } from 'vitest';
import { assertProductionDependencies, resolveConnectionUrls, resolveTrustedProxyHops } from './startupConfig.js';

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


describe('trusted reverse proxy configuration', () => {
  it('defaults to one ingress proxy hop rather than trusting every forwarded address', () => {
    expect(resolveTrustedProxyHops()).toBe(1);
    expect(resolveTrustedProxyHops('')).toBe(1);
  });

  it('accepts a bounded explicit proxy hop count', () => {
    expect(resolveTrustedProxyHops('2')).toBe(2);
    expect(resolveTrustedProxyHops('5')).toBe(5);
  });

  it.each(['0', '6', '-1', '1.5', 'all', 'NaN'])('rejects unsafe proxy hop configuration %s', (value) => {
    expect(() => resolveTrustedProxyHops(value)).toThrow(
      'TRUST_PROXY_HOPS must be an integer between 1 and 5.',
    );
  });
});
