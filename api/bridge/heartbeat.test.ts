import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from './heartbeat';

function responseMock() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    end(value?: string) { this.body = value || ''; },
  };
  return response;
}
function requestMock(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-user-session',
      origin: 'https://app.example.com',
      host: 'app.example.com',
      'x-forwarded-host': 'app.example.com',
    },
    ...overrides,
  };
}
const envKeys = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'BRIDGE_INTERNAL_URL',
  'BRIDGE_VERCEL_ADAPTER_TOKEN',
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('Vercel bridge adapter function', () => {
  it('validates Supabase identity before registering Vercel readiness', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.BRIDGE_INTERNAL_URL = 'https://bridge.example.com';
    process.env.BRIDGE_VERCEL_ADAPTER_TOKEN = 'vercel-adapter-token-with-at-least-32-characters';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'user-1', is_anonymous: false }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseMock();
    await handler(requestMock() as unknown as IncomingMessage, response as unknown as ServerResponse);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ready', adapter: 'vercel' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://bridge.example.com/internal/adapters/vercel/heartbeat');
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe('Bearer vercel-adapter-token-with-at-least-32-characters');
  });

  it('rejects invalid Supabase sessions without touching the bridge', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.BRIDGE_INTERNAL_URL = 'https://bridge.example.com';
    process.env.BRIDGE_VERCEL_ADAPTER_TOKEN = 'vercel-adapter-token-with-at-least-32-characters';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseMock();
    await handler(requestMock() as unknown as IncomingMessage, response as unknown as ServerResponse);
    expect(response.statusCode).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-origin requests and non-HTTPS production bridge URLs', async () => {
    const response = responseMock();
    await handler(requestMock({ headers: { origin: 'https://attacker.example', host: 'app.example.com' } }) as unknown as IncomingMessage, response as unknown as ServerResponse);
    expect(response.statusCode).toBe(403);
  });
});
