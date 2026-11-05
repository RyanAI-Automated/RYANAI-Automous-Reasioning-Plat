import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const {
  createContextClient, getUser, listOpenActions, decideAction
} = vi.hoisted(() => ({
  createContextClient: vi.fn(),
  getUser: vi.fn(),
  listOpenActions: vi.fn(),
  decideAction: vi.fn()
}));

vi.mock('@supabase/server/core', () => ({ createContextClient }));
vi.mock('../../approvals/pendingStore.js', () => ({ listOpenActions }));
vi.mock('../../approvals/service.js', () => ({ decideAction }));

import { installAuthentication } from './auth.js';
import { pendingActionsRoutes } from './pendingActions.js';

const actionId = '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11';
const bearer = { authorization: 'Bearer synthetic-approval-access-token' };
const apps: FastifyInstance[] = [];

function identity(role: 'user' | 'admin' = 'user') {
  return {
    id: 'verified-' + role + '-id',
    email: role + '@example.test',
    app_metadata: role === 'admin' ? { role: 'admin' } : {},
    user_metadata: { role: 'admin' },
    is_anonymous: false
  };
}

async function createApp() {
  const app = Fastify();
  apps.push(app);
  installAuthentication(app);
  await app.register(pendingActionsRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://synthetic-project.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'synthetic-publishable-key');
  createContextClient.mockReturnValue({ auth: { getUser } });
  getUser.mockResolvedValue({ data: { user: identity('admin') }, error: null });
  listOpenActions.mockResolvedValue([]);
  decideAction.mockResolvedValue({ outcome: 'executed', result: 'synthetic-only' });
  vi.clearAllMocks();
});

afterAll(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.unstubAllEnvs();
});

describe('real administrator guard for pending approval actions', () => {
  it('rejects missing or malformed bearer credentials before reaching the approval service', async () => {
    const app = await createApp();
    const noToken = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`
    });
    const malformed = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`,
      headers: { authorization: 'Basic not-a-bearer' }
    });
    expect(noToken.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });

  it('rejects a verified member even when editable user metadata claims admin', async () => {
    getUser.mockResolvedValue({
      data: { user: identity('user') },
      error: null
    });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`, headers: bearer
    });
    expect(response.statusCode).toBe(403);
    expect(decideAction).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'throws'] as const)(
    'fails closed when the authenticated identity provider %s',
    async failure => {
      if (failure === 'throws') {
        getUser.mockRejectedValue(new Error('synthetic auth provider outage'));
      } else {
        getUser.mockResolvedValue({
          data: { user: null },
          error: { status: 503, message: 'synthetic auth provider unavailable' }
        });
      }
      const app = await createApp();
      const response = await app.inject({
        method: 'POST', url: `/api/actions/${actionId}/approve`, headers: bearer
      });
      expect(response.statusCode).toBe(503);
      expect(decideAction).not.toHaveBeenCalled();
    }
  );

  it('uses only the Supabase-verified administrator identity to decide the pending action', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`, headers: bearer
    });
    expect(response.statusCode).toBe(200);
    expect(decideAction).toHaveBeenCalledExactlyOnceWith(actionId, 'verified-admin-id', true);
    expect(response.json()).toEqual({ status: 'executed', result: 'synthetic-only' });
  });
});
