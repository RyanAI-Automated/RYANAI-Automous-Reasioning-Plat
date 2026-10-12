import { API_BASE_URL } from './apiBaseUrl';
import { API_ROUTES } from '@/config/core';

export interface PlatformHealth {
  status: string;
  service?: string;
  timestamp?: string;
  services?: Record<string, boolean>;
  engine?: string;
  activeGraph?: string;
}

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
    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `API health check failed (HTTP ${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
      );
    }

    let health: PlatformHealth;
    try {
      health = JSON.parse(body) as PlatformHealth;
    } catch {
      throw new Error('API health endpoint returned invalid JSON.');
    }
    if (health.status !== 'online') {
      throw new Error('RyanAI API did not report an online status.');
    }
    return health;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error('API health check timed out after 5 seconds.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
