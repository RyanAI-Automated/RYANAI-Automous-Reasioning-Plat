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
  it('uses the proxied API endpoint and clears the deadline after success', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status: 'online' }))),
    );
    await expect(getPlatformHealth()).resolves.toEqual({ status: 'online' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/health$/),
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
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
      const outcome = expect(
        getPlatformHealth(controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
      if (!alreadyAborted) controller.abort();
      await outcome;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    new Response('unavailable', { status: 503 }),
    new Response('<!doctype html>'),
    new Response(JSON.stringify({ status: 'degraded' })),
  ])('rejects unhealthy or non-API responses', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(getPlatformHealth()).rejects.toThrow();
  });
});
