import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('runtime environment configuration', () => {
  it('uses production logging when the container supplies NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { getConfig } = await import('./config.js');
    expect(getConfig().nodeEnv).toBe('production');
  });

  it('keeps an explicit configuration override', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { initConfig } = await import('./config.js');
    expect(initConfig({ nodeEnv: 'development' }).nodeEnv).toBe('development');
  });

  it('defaults to development without NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', undefined);
    const { getConfig } = await import('./config.js');
    expect(getConfig().nodeEnv).toBe('development');
  });
});
