import { useCallback, useEffect, useState } from 'react';
import { getPlatformHealth, type PlatformHealth } from '@/lib/platformHealth';

export function usePlatformHealth(refreshIntervalMs = 30_000) {
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const nextHealth = await getPlatformHealth(signal);
      setHealth(nextHealth);
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setHealth(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Defer the async fetch kickoff so this effect does not synchronously trigger state updates.
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return refresh(controller.signal);
    });
    const timer = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh, refreshIntervalMs]);

  const manualRefresh = useCallback(() => {
    setChecking(true);
    return refresh();
  }, [refresh]);

  return { health, error, checking, refresh: manualRefresh };
}
