import { useCallback, useEffect, useState } from 'react';
import { getPlatformHealth, type PlatformHealth } from '@/lib/platformHealth';

export function usePlatformHealth(refreshIntervalMs = 30_000) {
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Fetch and record health; state updates happen only after the request settles.
  const load = useCallback(
    (signal?: AbortSignal) =>
      getPlatformHealth(signal)
        .then(
          (nextHealth) => {
            setHealth(nextHealth);
            setError(null);
          },
          (cause: unknown) => {
            if (signal?.aborted) return;
            setHealth(null);
            setError(cause instanceof Error ? cause.message : String(cause));
          },
        )
        .finally(() => {
          if (!signal?.aborted) setChecking(false);
        }),
    [],
  );

  const refresh = useCallback(() => {
    setChecking(true);
    return load();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load, refresh, refreshIntervalMs]);

  return { health, error, checking, refresh: () => refresh() };
}
