// @vitest-environment happy-dom
import { act } from 'react';
import ReactDOM, { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ErrorBoundary from './components/ErrorBoundary';

vi.mock('./App', () => ({
  default: () => <nav aria-label="Main navigation">RyanAI workspace</nav>,
}));
vi.mock('./lib/platformHealth', () => ({
  getPlatformHealth: () => new Promise(() => {}),
}));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./lib/supabase', () => ({ supabase: { auth: { getSession } } }));
vi.mock('./lib/apiBaseUrl', () => ({ API_BASE_URL: 'https://api.example.test' }));
beforeEach(() => {
  getSession.mockReset().mockResolvedValue({
    data: { session: { access_token: 'current-session' } },
    error: null,
  });
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.restoreAllMocks());

it('mounts the UI while the backend health request remains pending', async () => {
  const mount = vi.spyOn(ReactDOM, 'createRoot');
  document.body.innerHTML = '<div id="root">Loading...</div>';
  await act(async () => {
    await import('./main');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });
  expect(mount).toHaveBeenCalledOnce();
  expect(document.querySelector('nav')?.textContent).toBe('RyanAI workspace');
  expect(document.getElementById('root')?.textContent).not.toContain(
    'Loading...',
  );
});

it('shows a recovery action when a view throws during rendering', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function BrokenView(): never {
    throw new Error('view failed');
  }
  try {
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenView />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'RyanAI could not load this view',
    );
    expect(container.querySelector('button')?.textContent).toBe(
      'Reload RyanAI',
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('sends requests with method, body and headers and returns parsed JSON', async () => {
  const { apiClient, API_BASE_URL, APP_VERSION, APP_ENV } = await import('./main');
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })));
  expect(APP_ENV).toBe(import.meta.env.MODE);
  await expect(apiClient.request('/api/example', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'hello' }),
    headers: new Headers({ Authorization: 'Bearer test-token' }),
  })).resolves.toEqual({ result: 'ok' });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(`${API_BASE_URL}/api/example`);
  expect(options?.method).toBe('POST');
  expect(options?.body).toBe(JSON.stringify({ prompt: 'hello' }));
  const headers = new Headers(options?.headers);
  expect(headers.get('Content-Type')).toBe('application/json');
  expect(headers.get('X-App-Version')).toBe(APP_VERSION);
  expect(headers.get('Authorization')).toBe('Bearer current-session');
});

it('rejects unsuccessful API responses', async () => {
  const { apiClient } = await import('./main');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
  await expect(apiClient.request('/api/example')).rejects.toThrow('API Error: 503');
});
