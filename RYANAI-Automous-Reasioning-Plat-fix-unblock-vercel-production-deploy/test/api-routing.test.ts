import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigEnv, UserConfigFnObject } from 'vite';
import viteConfig from '../vite.config';

const config = viteConfig as UserConfigFnObject;
const buildEnv: ConfigEnv = { command: 'build', mode: 'production' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function vercelEnv(baseUrl = '') {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VITE_API_BASE_URL', baseUrl);
  vi.stubEnv('VITE_API_URL', '');
  vi.stubEnv('VERCEL_URL', 'frontend-preview.vercel.app');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'frontend.vercel.app');
}

describe('Vercel API routing', () => {
  it.each([
    '',
    '   ',
    '/api',
    'not a URL',
    'http://api.example.com',
    'https://api.example.com/api',
    'https://api.example.com/?token=value',
    'https://api.example.com/#route',
    'https://user:password@api.example.com',
    'https://frontend-preview.vercel.app',
    'https://frontend.vercel.app',
  ])('rejects an unsafe or missing API origin: %s', (url) => {
    vercelEnv(url);
    expect(() => config(buildEnv)).toThrow('Set VITE_API_BASE_URL');
  });

  it('accepts a separate HTTPS API origin with whitespace and a trailing slash', async () => {
    vercelEnv(' https://api.example.com/ ');
    expect(() => config(buildEnv)).not.toThrow();
    expect((await import('../src/lib/apiBaseUrl')).API_BASE_URL).toBe(
      'https://api.example.com',
    );
  });

  it('uses the legacy setting when the primary setting is blank', async () => {
    vercelEnv('   ');
    vi.stubEnv('VITE_API_URL', ' https://legacy-api.example.com/ ');
    expect(() => config(buildEnv)).not.toThrow();
    expect((await import('../src/lib/apiBaseUrl')).API_BASE_URL).toBe(
      'https://legacy-api.example.com',
    );
  });

  it('preserves local development and non-Vercel same-origin deployments', () => {
    vercelEnv();
    expect(() => config({ ...buildEnv, command: 'serve' })).not.toThrow();
    vi.stubEnv('VERCEL', '');
    expect(() => config(buildEnv)).not.toThrow();
  });
});
