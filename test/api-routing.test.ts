import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigEnv } from 'vite';
import viteConfig from '../vite.config';

const config = viteConfig as (env: ConfigEnv) => { server?: { proxy?: Record<string, { target?: string }> } };
const buildEnv: ConfigEnv = { command: 'build', mode: 'production' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Render and Railway API routing', () => {
  it('uses the Render API origin when configured for the web frontend', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://ryanai-api.onrender.com');
    const resolved = config(buildEnv);
    expect(resolved.server?.proxy?.['/api']?.target).toBe('https://ryanai-api.onrender.com');
  });

  it('uses the legacy API URL when the primary value is absent', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
    const resolved = config(buildEnv);
    expect(resolved.server?.proxy?.['/api']?.target).toBe('https://api.example.com');
  });

  it('falls back to the local API for local builds without deployment variables', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_API_URL', '');
    const resolved = config(buildEnv);
    expect(resolved.server?.proxy?.['/api']?.target).toBe('http://127.0.0.1:3001');
  });
});
