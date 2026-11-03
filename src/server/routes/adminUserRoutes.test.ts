import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminUserRoutes } from './adminUserRoutes.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

async function createApp(role: 'user' | 'admin', isOwner = false) {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { authUser: unknown }).authUser = {
      id: 'owner-or-admin-id',
      email: 'operator@example.test',
      role,
      isOwner,
      sessionId: 'test-session-id',
    };
  });
  await app.register(adminUserRoutes);
  return app;
}

describe('owner-governed identity role API', () => {
  it('fails closed when the server-side Supabase service-role key is absent', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const app = await createApp('admin', true);
    const response = await app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('not configured');
    await app.close();
  });

  it('denies role changes to an administrator who is not the configured owner', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const app = await createApp('admin', false);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/00000000-0000-4000-8000-000000000001/role',
      payload: { role: 'admin' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('requires the server-side identity administration credential even for the owner', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const app = await createApp('admin', true);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/00000000-0000-4000-8000-000000000001/role',
      payload: { role: 'admin' },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
