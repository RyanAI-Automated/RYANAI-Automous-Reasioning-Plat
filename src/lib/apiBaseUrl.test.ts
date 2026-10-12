import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.stubEnv('VITE_API_URL', '');
  vi.stubGlobal('window', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  [
    ' https://primary.example/// ',
    'https://legacy.example',
    'https://primary.example',
  ],
  ['   ', ' https://legacy.example/// ', 'https://legacy.example'],
  ['', '', 'http://localhost:3000'],
])(
  'normalizes API configuration (%j, %j)',
  async (primary, legacy, expected) => {
    vi.stubEnv('VITE_API_BASE_URL', primary);
    vi.stubEnv('VITE_API_URL', legacy);
    expect((await import('./apiBaseUrl')).API_BASE_URL).toBe(expected);
  },
);

it('uses the browser origin when both configured URLs contain only whitespace', async () => {
  vi.stubEnv('VITE_API_BASE_URL', '  ');
  vi.stubEnv('VITE_API_URL', '\t');
  vi.stubGlobal('window', { location: { origin: 'https://web.example' } });
  expect((await import('./apiBaseUrl')).API_BASE_URL).toBe(
    'https://web.example',
  );
});
