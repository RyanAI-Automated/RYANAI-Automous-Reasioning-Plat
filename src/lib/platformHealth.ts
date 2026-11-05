import { API_BASE_URL } from './apiBaseUrl';
import { API_ROUTES } from '@/config/core';

export interface PlatformHealth {
  status: 'online' | 'degraded';
  service?: string;
  timestamp?: string;
  services?: Record<string, boolean>;
  engine?: string;
  activeGraph?: string;
}

/**
 * Fetch the runtime readiness payload with a five-second deadline.
 * HTTP 503 is a valid degraded-readiness response when it contains the
 * sanitized service snapshot. Error bodies are never copied into UI messages.
 */
export async function getPlatformHealth(
  signal?: AbortSignal,
): Promise<PlatformHealth> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 5000);

  try {
    const response = await fetch(`${API_BASE_URL}${API_ROUTES.healthPath}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (response.status !== 200 && response.status !== 503) {
      throw new Error(`API health check failed (HTTP ${response.status}).`);
    }

    let health: PlatformHealth;
    try {
      health = (await response.json()) as PlatformHealth;
    } catch {
      throw new Error('API health endpoint returned invalid JSON.');
    }

    if (
      (health.status !== 'online' && health.status !== 'degraded') ||
      (response.status === 200 && health.status !== 'online') ||
      (response.status === 503 && health.status !== 'degraded')
    ) {
      throw new Error('API health endpoint returned an invalid readiness status.');
    }

    return health;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error('API health check timed out after 5 seconds.', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
