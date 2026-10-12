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
      const error = new Error('redis://fixture:private-password@fixture:6379');
      if (failure === 'reject') redis.connect.mockRejectedValue(error);
      else
        redis.connect.mockImplementation(() => {
          throw error;
        });
      const result = connectRedis('redis://fixture:6379');
      await expect(result).rejects.toThrow('Redis is unavailable');
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
