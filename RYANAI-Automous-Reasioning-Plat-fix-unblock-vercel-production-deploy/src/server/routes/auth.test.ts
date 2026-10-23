import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { once } from 'node:events';
import { registerWebSocketRoutes } from '../../api/websocket.js';
import { authPlugin, installAuthentication } from './auth.js';
import { approvalRoutes } from './approvalRoutes.js';

const { getUser, createContextClient, invoke, getState } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createContextClient: vi.fn(),
  invoke: vi.fn(),
  getState: vi.fn(),
}));
vi.mock('@supabase/server/core', () => ({ createContextClient }));
vi.mock('../../shared/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../agent/approvalEngine.js', () => ({
  humanInTheLoopAgent: { invoke, getState },
}));
vi.mock('../../agent/supervisorGraph.js', () => ({
  enterpriseMultiAgent: { invoke, getState },
}));
vi.mock('../../utils/notifications.js', () => ({
  notifyPendingApproval: vi.fn(),
}));

const applications: FastifyInstance[] = [];
const bearer = { authorization: 'Bearer synthetic-access-token' };
const user = {
  id: 'verified-user-id',
  email: 'member@example.test',
  app_metadata: {},
  user_metadata: { role: 'admin' },
  is_anonymous: false,
};

async function createApp(standaloneApprovals = false) {
  const app = Fastify();
  applications.push(app);
  if (standaloneApprovals) {
    await app.register(approvalRoutes);
  } else {
    installAuthentication(app);
    await app.register(cors, { origin: true });
    await app.register(authPlugin);
    await app.register(async (nested) => {
      nested.get('/health', async () => ({ healthy: true }));
      nested.get('/', async () => ({ healthy: true }));
      nested.post('/api/reason', async (request) => ({
        user: request.authUser,
      }));
      nested.post('/api/reasoning/stream', async () => ({ allowed: true }));
      nested.get('/api/metrics', async () => ({ allowed: true }));
      nested.post('/api/comms/send', async () => ({ allowed: true }));
      nested.get('/ws', async () => ({ allowed: true }));
      nested.get('/api/new-admin-feature', async () => ({ allowed: true }));
      await nested.register(approvalRoutes);
    });
  }
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'synthetic-publishable-key');
  createContextClient.mockReturnValue({ auth: { getUser } });
  getUser.mockResolvedValue({ data: { user }, error: null });
  invoke.mockResolvedValue({ messages: [{ content: 'done' }] });
  getState.mockResolvedValue({ next: [], values: { messages: [] } });
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('Supabase API authentication', () => {
  it.each([undefined, 'Basic password', 'Bearer', 'Bearer token extra'])(
    'rejects missing or malformed bearer credentials: %s',
    async (authorization) => {
      const app = await createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/reason',
        headers: authorization ? { authorization } : {},
      });
      expect(response.statusCode).toBe(401);
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it.each(['invalid token', 'expired token'])(
    'rejects an %s rejected by Supabase',
    async (message) => {
      getUser.mockResolvedValue({
        data: { user: null },
        error: { status: 401, message },
      });
      const app = await createApp();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/reason',
            headers: bearer,
          })
        ).statusCode,
      ).toBe(401);
    },
  );

  it('rejects anonymous Supabase identities', async () => {
    getUser.mockResolvedValue({
      data: { user: { ...user, is_anonymous: true } },
      error: null,
    });
    const app = await createApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/reason',
          headers: bearer,
        })
      ).statusCode,
    ).toBe(401);
  });

  it.each(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'])(
    'fails closed when %s is missing',
    async (name) => {
      vi.stubEnv(name, '');
      const app = await createApp();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/reason',
            headers: bearer,
          })
        ).statusCode,
      ).toBe(503);
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it.each(['error', 'throw'])(
    'reports an unavailable identity provider (%s)',
    async (failure) => {
      if (failure === 'throw')
        getUser.mockRejectedValue(new Error('network timeout'));
      else
        getUser.mockResolvedValue({
          data: { user: null },
          error: { status: 503 },
        });
      const app = await createApp();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/reason',
            headers: bearer,
          })
        ).statusCode,
      ).toBe(503);
    },
  );

  it('uses the verified identity and ignores client-editable admin metadata', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/verify',
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      user: { id: user.id, email: user.email, role: 'user' },
    });
    expect(getUser).toHaveBeenCalledExactlyOnceWith('synthetic-access-token');
    expect(createContextClient).toHaveBeenCalledWith(
      expect.objectContaining({
        env: {
          url: 'https://project.supabase.co',
          publishableKeys: { default: 'synthetic-publishable-key' },
        },
        auth: { token: 'synthetic-access-token' },
      }),
    );
  });

  it.each(['/api/reason', '/api/reasoning/stream'])(
    'allows ordinary members to use %s',
    async (url) => {
      const app = await createApp();
      expect(
        (await app.inject({ method: 'POST', url, headers: bearer })).statusCode,
      ).toBe(200);
    },
  );

  it.each([
    ['GET', '/api/metrics'],
    ['POST', '/api/comms/send'],
    ['GET', '/ws'],
    ['POST', '/api/reason/approve'],
    ['GET', '/api/new-admin-feature'],
  ] as const)('denies ordinary members %s %s', async (method, url) => {
    const app = await createApp();
    expect(
      (
        await app.inject({
          method,
          url,
          headers: bearer,
          ...(method === 'POST'
            ? { payload: { threadId: 'other-user-thread', approved: true } }
            : {}),
        })
      ).statusCode,
    ).toBe(403);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/api/metrics'],
    ['POST', '/api/comms/send'],
    ['GET', '/ws'],
    ['POST', '/api/reason/approve'],
  ] as const)('allows verified admins %s %s', async (method, url) => {
    getUser.mockResolvedValue({
      data: { user: { ...user, app_metadata: { role: 'admin' } } },
      error: null,
    });
    const app = await createApp();
    expect(
      (
        await app.inject({
          method,
          url,
          headers: bearer,
          ...(method === 'POST'
            ? { payload: { threadId: 'pending-thread', approved: true } }
            : {}),
        })
      ).statusCode,
    ).toBe(200);
  });

  it.each(['/api/auth/login', '/api/auth/logout'])(
    'retires the old shared-password identity at %s',
    async (url) => {
      const app = await createApp();
      const response = await app.inject({
        method: 'POST',
        url,
        payload: { username: 'admin', password: 'password' },
      });
      expect(response.statusCode).toBe(410);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it('keeps health checks and CORS preflights public', async () => {
    const app = await createApp();
    for (const url of ['/', '/health'])
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/reason',
      headers: {
        origin: 'https://app.example.test',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(getUser).not.toHaveBeenCalled();
  });
});

it('limits protected HTTP requests before Supabase verification', async () => {
  const app = Fastify();
  applications.push(app);
  // The guard is installed first, just like launcher.ts. onRequest limits must
  // still run before the guard's preValidation hook.
  installAuthentication(app);
  await app.register(rateLimit, { max: 2, timeWindow: '1 minute' });
  app.post('/api/reason', async () => ({ success: true }));
  await app.ready();
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/reason',
          headers: bearer,
        })
      ).statusCode,
    ).toBe(200);
  }
  expect(
    (await app.inject({ method: 'POST', url: '/api/reason', headers: bearer }))
      .statusCode,
  ).toBe(429);
  expect(getUser).toHaveBeenCalledTimes(2);
});

describe('approval plugin defense in depth', () => {
  it('fails closed when registered without the global hook or a JWT plugin', async () => {
    const app = await createApp(true);
    const response = await app.inject({
      method: 'POST',
      url: '/api/reason/approve',
      payload: { threadId: 'pending-thread', approved: true },
    });
    expect(response.statusCode).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not allow regular verified users to approve another thread', async () => {
    const app = await createApp(true);
    const response = await app.inject({
      method: 'POST',
      url: '/api/reason/approve',
      headers: bearer,
      payload: { threadId: 'pending-thread', approved: true },
    });
    expect(response.statusCode).toBe(403);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('websocket upgrade authentication', () => {
  async function createSocketApp() {
    const app = Fastify();
    applications.push(app);
    // Exercise the route's own guard even if the global hook was not installed.
    // injectWS uses in-memory streams without a remote IP; model one peer.
    await app.register(rateLimit, {
      global: false,
      keyGenerator: () => 'test-peer',
    });
    await app.register(websocket);
    await registerWebSocketRoutes(app);
    await app.ready();
    return app;
  }

  it('rejects an unauthenticated upgrade', async () => {
    const app = await createSocketApp();
    await expect(app.injectWS('/ws')).rejects.toThrow(
      'Unexpected server response: 401',
    );
  });

  it('rejects a member upgrade even with admin claims in editable user metadata', async () => {
    const app = await createSocketApp();
    await expect(app.injectWS('/ws', { headers: bearer })).rejects.toThrow(
      'Unexpected server response: 403',
    );
  });

  it('rate-limits failed upgrades before performing more provider verification', async () => {
    const app = await createSocketApp();
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(app.injectWS('/ws', { headers: bearer })).rejects.toThrow(
        'Unexpected server response: 403',
      );
    }
    await expect(app.injectWS('/ws', { headers: bearer })).rejects.toThrow(
      'Unexpected server response: 429',
    );
    expect(getUser).toHaveBeenCalledTimes(10);
  });

  it('closes connections that exceed the message budget', async () => {
    getUser.mockResolvedValue({
      data: { user: { ...user, app_metadata: { role: 'admin' } } },
      error: null,
    });
    const app = await createSocketApp();
    const socket = await app.injectWS('/ws', { headers: bearer });
    const closed = once(socket, 'close');
    for (let index = 0; index < 61; index++) {
      socket.send(
        JSON.stringify({
          id: String(index),
          type: 'request',
          channel: 'auth.verify',
        }),
      );
    }
    const [code] = await closed;
    expect(code).toBe(1008);
  });

  it('binds an accepted admin socket to the verified identity', async () => {
    getUser.mockResolvedValue({
      data: { user: { ...user, app_metadata: { role: 'admin' } } },
      error: null,
    });
    const app = await createSocketApp();
    const socket = await app.injectWS('/ws', { headers: bearer });
    try {
      const message = once(socket, 'message');
      socket.send(
        JSON.stringify({
          id: 'verify-request',
          type: 'request',
          channel: 'auth.verify',
        }),
      );
      const [data] = await message;
      expect(JSON.parse(data.toString()).data).toEqual({
        authenticated: true,
        userId: user.id,
      });
    } finally {
      const closed = once(socket, 'close');
      socket.close();
      await closed;
    }
  });
});
