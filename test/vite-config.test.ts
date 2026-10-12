import type { ConfigEnv } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../vite.config';

vi.mock('vite', () => ({
  defineConfig: (value: unknown) => value,
  loadEnv: () => ({}),
}));
vi.mock('@vitejs/plugin-react', () => ({
  default: () => ({ name: 'react-fixture' }),
}));

const resolveConfig = config as (env: ConfigEnv) => unknown;
const build: ConfigEnv = { command: 'build', mode: 'production' };

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_URL', 'preview.example.test');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'web.example.test');
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.stubEnv('VITE_API_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('Vercel API origin validation', () => {
  it.each([
    '',
    'not-a-url',
    'http://api.example.test',
    'https://api.example.test/api',
    'https://api.example.test/?mode=test',
    'https://api.example.test/#section',
    'https://user:password@api.example.test',
    'https://preview.example.test',
    'https://web.example.test',
  ])('rejects invalid or frontend API configuration %j', (url) => {
    vi.stubEnv('VITE_API_BASE_URL', url);
    expect(() => resolveConfig(build)).toThrow(
      'Set VITE_API_BASE_URL to the HTTPS origin',
    );
  });

  it.each([
    'https://api.example.test',
    ' https://api.example.test/ ',
    'https://api.example.test:8443',
  ])('accepts a separate HTTPS API origin %j', (url) => {
    vi.stubEnv('VITE_API_BASE_URL', url);
    expect(() => resolveConfig(build)).not.toThrow();
  });

  it('uses the legacy URL when the primary configuration is whitespace', () => {
    vi.stubEnv('VITE_API_BASE_URL', '  ');
    vi.stubEnv('VITE_API_URL', ' https://api.example.test/ ');
    expect(() => resolveConfig(build)).not.toThrow();
  });

  it('does not let a valid legacy URL hide an invalid primary URL', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://web.example.test');
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    expect(() => resolveConfig(build)).toThrow('Set VITE_API_BASE_URL');
  });

  it('permits same-origin development and non-Vercel builds', () => {
    expect(() =>
      resolveConfig({ command: 'serve', mode: 'development' }),
    ).not.toThrow();
    vi.stubEnv('VERCEL', '0');
    expect(() => resolveConfig(build)).not.toThrow();
  });
});
