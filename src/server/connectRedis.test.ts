import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectRedis } from './connectRedis';

const redis = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));
vi.mock('ioredis', () => ({
  Redis: function (...args: unknown[]) {
    redis.construct(...args);
    return redis;
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  redis.connect.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('Redis initial readiness', () => {
  it('returns a connected client and clears the initial deadline without disabling reconnection', async () => {
    await expect(connectRedis('redis://fixture:6379')).resolves.toBe(redis);
    expect(redis.construct).toHaveBeenCalledWith('redis://fixture:6379', {
      lazyConnect: true,
      connectTimeout: 5000,
    });
    expect(redis.connect).toHaveBeenCalledOnce();
    expect(redis.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(redis.disconnect).not.toHaveBeenCalled();
  });

  it.each(['reject', 'throw'])(
    'disconnects and sanitizes a connection failure (%s)',
    async (failure) => {
      const error = Object.assign(
        new Error('redis://fixture:private-password@fixture:6379'),
        { code: 'WRONGPASS' },
      );
      if (failure === 'reject') redis.connect.mockRejectedValue(error);
      else
        redis.connect.mockImplementation(() => {
          throw error;
        });
      const result = connectRedis('redis://fixture:6379');
      await expect(result).rejects.toThrow('Redis is unavailable (WRONGPASS)');
      await expect(result).rejects.not.toThrow('private-password');
      expect(redis.disconnect).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('waits until the exact configured deadline before disconnecting a stalled client', async () => {
    redis.connect.mockReturnValue(new Promise(() => {}));
    const settled = vi.fn();
    const outcome = connectRedis('redis://fixture:6379', 250).catch(settled);
    await vi.advanceTimersByTimeAsync(249);
    expect(settled).not.toHaveBeenCalled();
    expect(redis.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Redis is unavailable'),
      }),
    );
    expect(redis.construct).toHaveBeenCalledWith('redis://fixture:6379', {
      lazyConnect: true,
      connectTimeout: 250,
    });
    expect(redis.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a sanitized asynchronous socket error when readiness later times out', async () => {
    redis.connect.mockReturnValue(new Promise(() => {}));
    const connection = connectRedis('redis://fixture:private-password@fixture:6379', 250);
    const errorHandler = redis.on.mock.calls.find(([event]) => event === 'error')?.[1] as
      | ((error: unknown) => void)
      | undefined;
    expect(errorHandler).toBeTypeOf('function');
    errorHandler?.(
      Object.assign(
        new Error('connect ECONNREFUSED redis://fixture:private-password@fixture:6379'),
        { code: 'ECONNREFUSED' },
      ),
    );

    const outcome = connection.catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(250);
    await expect(outcome).resolves.toContain('Redis is unavailable (ECONNREFUSED)');
    await expect(outcome).resolves.not.toContain('private-password');
    expect(redis.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the deadline when readiness arrives just before it', async () => {
    let ready!: () => void;
    redis.connect.mockReturnValue(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    const connection = connectRedis('redis://fixture:6379', 250);
    await vi.advanceTimersByTimeAsync(249);
    ready();
    await expect(connection).resolves.toBe(redis);
    await vi.advanceTimersByTimeAsync(1);
    expect(redis.disconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Redis connection URL inspection', () => {
  it('recognizes a Render internal unauthenticated URL', async () => {
    const { inspectRedisConnectionUrl } = await import('./connectRedis.js');
    expect(inspectRedisConnectionUrl('redis://red-example:6379')).toEqual({
      protocol: 'redis:', host: 'red-example', port: 6379, database: 0, tls: false, authenticated: false,
    });
  });

  it('recognizes authenticated internal URLs without returning credentials', async () => {
    const { inspectRedisConnectionUrl } = await import('./connectRedis.js');
    expect(inspectRedisConnectionUrl('redis://default:secret-value@red-example:6379/2')).toEqual({
      protocol: 'redis:', host: 'red-example', port: 6379, database: 2, tls: false, authenticated: true,
    });
  });

  it('recognizes external TLS URLs', async () => {
    const { inspectRedisConnectionUrl } = await import('./connectRedis.js');
    expect(inspectRedisConnectionUrl('rediss://default:secret-value@region-kv.render.com:6379/0')).toEqual({
      protocol: 'rediss:', host: 'region-kv.render.com', port: 6379, database: 0, tls: true, authenticated: true,
    });
  });

  it('supports IPv6 hosts and explicit ports', async () => {
    const { inspectRedisConnectionUrl } = await import('./connectRedis.js');
    expect(inspectRedisConnectionUrl('redis://[::1]:6380/4')).toMatchObject({
      host: '[::1]', port: 6380, database: 4,
    });
  });

  it.each([
    'https://redis.example:6379',
    'ftp://redis.example:6379',
    'not-a-url',
    'redis:///missing-host',
    'redis://redis.example:70000',
    'redis://redis.example/not-a-database',
  ])('rejects malformed or unsupported URL %s', async (url) => {
    const { inspectRedisConnectionUrl } = await import('./connectRedis.js');
    expect(() => inspectRedisConnectionUrl(url)).toThrow(/REDIS_URL/);
  });

  it('does not include credentials in validation errors', async () => {
    const { inspectRedisConnectionUrl } = await import('./connectRedis.js');
    expect(() => inspectRedisConnectionUrl('https://user:super-secret@redis.example:6379'))
      .toThrow(/REDIS_URL/);
  });
});
