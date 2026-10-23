import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const state = vi.hoisted(() => ({
  app: undefined as FastifyInstance | undefined,
  invoke: vi.fn(),
  listen: vi.fn().mockResolvedValue('http://localhost:3000'),
}));

// Exercise the real launcher's routes without external services or a TCP listener.
vi.mock('../loadEnv.js', () => ({}));
vi.mock('../instrument.js', () => ({}));
vi.mock('../telemetry.js', () => ({}));
vi.mock('fastify', async (importOriginal) => {
  const { default: Fastify } = await importOriginal<typeof import('fastify')>();
  return {
    default: () => {
      state.app = Fastify();
      state.app.listen = state.listen;
      return state.app;
    },
  };
});
vi.mock('pg', () => ({
  default: {
    Pool: class {
      query = vi.fn().mockResolvedValue({ rows: [{ now: 'test' }] });
    },
  },
}));
vi.mock('./connectRedis.js', () => ({
  connectRedis: vi.fn().mockResolvedValue({}),
}));
vi.mock('@fastify/redis', async () => {
  const { default: fp } = await import('fastify-plugin');
  return {
    default: fp(async (app) => {
      app.decorate('redis', { ping: async () => 'PONG' });
    }),
  };
});
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('../api/websocket.js', () => ({
  registerWebSocketRoutes: async () => {},
}));
vi.mock('./routes/auth.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    installAuthentication: vi.fn(),
  };
});
vi.mock('./comms/index.js', () => ({ commsPlugin: async () => {} }));
vi.mock('./routes/approvalRoutes.js', () => ({
  approvalRoutes: async () => {},
}));
vi.mock('./routes/slackInteractions.js', () => ({
  slackInteractionsPlugin: async () => {},
}));
vi.mock('./routes/twilioWebhook.js', () => ({
  twilioWebhookPlugin: async () => {},
}));
vi.mock('./routes/metrics.js', () => ({ metricsRoutes: async () => {} }));
vi.mock('../agent/approvalEngine.js', () => ({
  initializeAgentDatabase: async () => {},
}));
vi.mock('../agent/engine.js', () => ({
  getReasoningAgent: () => ({ invoke: state.invoke }),
}));

const signals = ['SIGTERM', 'SIGINT'] as const;
const originalListeners = new Map(
  signals.map((signal) => [signal, process.listeners(signal)]),
);

beforeAll(async () => {
  await import('./launcher');
  await vi.waitFor(() => expect(state.listen).toHaveBeenCalledOnce());
});

afterAll(async () => {
  await state.app?.close();
  for (const signal of signals) {
    for (const listener of process.listeners(signal)) {
      if (!originalListeners.get(signal)?.includes(listener))
        process.removeListener(signal, listener);
    }
  }
});

describe('launcher reasoning routes', () => {
  it('serves cross-origin SSE with the CORS headers intact', async () => {
    state.invoke.mockResolvedValue({ messages: [{ content: 'answer' }] });
    const response = await state.app!.inject({
      method: 'POST',
      url: '/api/reasoning/stream',
      headers: { origin: 'https://frontend.vercel.app' },
      payload: { prompt: 'hello' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.body).toContain('"status":"complete","result":"answer"');
  });

  it('handles the browser CORS preflight', async () => {
    const response = await state.app!.inject({
      method: 'OPTIONS',
      url: '/api/reasoning/stream',
      headers: {
        origin: 'https://frontend.vercel.app',
        'access-control-request-method': 'POST',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain(
      'Content-Type',
    );
  });

  it('keeps the JSON reasoning endpoint available', async () => {
    state.invoke.mockResolvedValue({ messages: [{ content: 'answer' }] });
    const response = await state.app!.inject({
      method: 'POST',
      url: '/api/reason',
      payload: { prompt: 'hello' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, output: 'answer' });
  });

  it('rejects an empty prompt before starting the stream', async () => {
    const response = await state.app!.inject({
      method: 'POST',
      url: '/api/reasoning/stream',
      payload: { prompt: ' ' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('delivers provider failures as stream errors, not route 404s', async () => {
    state.invoke.mockRejectedValueOnce(new Error('Provider unavailable'));
    const response = await state.app!.inject({
      method: 'POST',
      url: '/api/reasoning/stream',
      payload: { prompt: 'hello' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"error":"Provider unavailable"');
    expect(response.body).not.toContain('"status":"complete"');
  });
});