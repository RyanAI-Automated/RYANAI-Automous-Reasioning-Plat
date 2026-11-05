import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlatformHealth } from './platformHealth';

function pendingFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = options.signal!;
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('platform health', () => {
  it('uses the configured API readiness endpoint and clears the deadline after success', async () => {
    vi.useFakeTimers();
    const health = {
      status: 'online',
      services: { api: true, database: true, redis: true, agentCheckpointer: true },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(health))));
    await expect(getPlatformHealth()).resolves.toEqual(health);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\\/api\\/health$/),
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a valid degraded service snapshot returned with HTTP 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'degraded',
            timestamp: '2026-11-05T10:00:00.000Z',
            services: { api: true, database: false, redis: true, agentCheckpointer: false },
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(getPlatformHealth()).resolves.toMatchObject({
      status: 'degraded',
      services: { api: true, database: false, redis: true, agentCheckpointer: false },
    });
  });

  it('does not expose arbitrary error response bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private connection string', { status: 500 })),
    );
    await expect(getPlatformHealth()).rejects.toThrow('HTTP 500');
    await expect(getPlatformHealth()).rejects.not.toThrow('private connection string');
  });

  it('aborts an unresponsive backend after five seconds', async () => {
    vi.useFakeTimers();
    pendingFetch();
    const outcome = expect(getPlatformHealth()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    'preserves caller cancellation (already aborted: %s)',
    async (alreadyAborted) => {
      vi.useFakeTimers();
      pendingFetch();
      const controller = new AbortController();
      if (alreadyAborted) controller.abort();
      const outcome = expect(getPlatformHealth(controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
      if (!alreadyAborted) controller.abort();
      await outcome;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    new Response('unavailable', { status: 503 }),
    new Response('<!doctype html>', { status: 200 }),
    new Response(JSON.stringify({ status: 'unknown' }), { status: 200 }),
    new Response(JSON.stringify({ status: 'online' }), { status: 503 }),
  ])('rejects invalid or non-health responses', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(getPlatformHealth()).rejects.toThrow();
  });
});
