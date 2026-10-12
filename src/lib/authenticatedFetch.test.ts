import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth: { getSession } } }));
vi.mock('./apiBaseUrl', () => ({ API_BASE_URL: 'https://api.example.test' }));
import { authenticatedFetch } from './authenticatedFetch';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  getSession.mockReset().mockResolvedValue({
    data: { session: { access_token: 'current-session' } },
    error: null,
  });
});

afterEach(() => vi.unstubAllGlobals());

it('attaches the current access token to JSON and streaming API requests', async () => {
  const signal = new AbortController().signal;
  await authenticatedFetch('https://api.example.test/api/reasoning/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'stale' },
    body: '{}',
    signal,
  });
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('https://api.example.test/api/reasoning/stream');
  expect(new Headers(init?.headers).get('authorization')).toBe(
    'Bearer current-session',
  );
  expect(new Headers(init?.headers).get('content-type')).toBe(
    'application/json',
  );
  expect(init).toMatchObject({
    signal,
    body: '{}',
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
  });
});

it('reads the refreshed session for each request', async () => {
  await authenticatedFetch('/api/reason');
  getSession.mockResolvedValue({
    data: { session: { access_token: 'refreshed' } },
    error: null,
  });
  await authenticatedFetch('/api/reason');
  expect(
    new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get(
      'authorization',
    ),
  ).toBe('Bearer refreshed');
});

it.each([
  { data: { session: null }, error: null },
  { data: { session: null }, error: new Error('expired') },
])('does not call the backend without a usable session', async (result) => {
  getSession.mockResolvedValue(result);
  await expect(authenticatedFetch('/api/reason')).rejects.toThrow('sign in');
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  'https://other.example/api/reason',
  '//other.example/api/reason',
  'https://api.example.test/health',
  'http://api.example.test/api/reason',
  'https://api.example.test:8443/api/reason',
  'https://api.example.test.attacker.test/api/reason',
  '/api/../health',
  '/api/%2e%2e/health',
  '/apiary/reason',
])('does not disclose a token to %s', async (url) => {
  await expect(authenticatedFetch(url)).rejects.toThrow('configured API');
  expect(getSession).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves caller headers without mutating them and overrides unsafe fetch options', async () => {
  const headers = new Headers({
    Authorization: 'stale',
    'X-Request-ID': 'fixture-id',
  });
  await authenticatedFetch('/api/reason?mode=fast', {
    headers,
    credentials: 'include',
    redirect: 'follow',
  });
  expect(headers.get('authorization')).toBe('stale');
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('https://api.example.test/api/reason?mode=fast');
  expect(new Headers(init?.headers).get('x-request-id')).toBe('fixture-id');
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
});

it('does not fetch when session retrieval rejects', async () => {
  const error = new Error('session service unavailable');
  getSession.mockRejectedValue(error);
  await expect(authenticatedFetch('/api/reason')).rejects.toBe(error);
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects a session accompanied by an authentication error', async () => {
  getSession.mockResolvedValue({
    data: { session: { access_token: 'stale-session' } },
    error: new Error('expired'),
  });
  await expect(authenticatedFetch('/api/reason')).rejects.toThrow('sign in');
  expect(fetch).not.toHaveBeenCalled();
});
