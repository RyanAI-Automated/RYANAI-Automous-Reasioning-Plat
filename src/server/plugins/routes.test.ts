import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { pluginRegistryRoutes } from './routes.js';

describe('plugin registry HTTP route', () => {
  it('requires an authenticated RyanAI user', async () => {
    const app = Fastify();
    app.decorateRequest('authUser', null);
    await app.register(pluginRegistryRoutes);
    const response = await app.inject({ method: 'GET', url: '/api/plugins/registry' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns catalogue metadata without claiming providers are connected', async () => {
    const app = Fastify();
    app.decorateRequest('authUser', null);
    app.addHook('onRequest', async (request) => {
      request.authUser = {
        id: 'user-fixture',
        role: 'user',
        isOwner: false,
      };
    });
    await app.register(pluginRegistryRoutes);
    const response = await app.inject({ method: 'GET', url: '/api/plugins/registry' });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as { providers: Array<{ id: string; adapterStatus: string }> };
    expect(payload.providers.length).toBeGreaterThan(0);
    expect(payload.providers.every((provider) => provider.adapterStatus === 'adapter_required')).toBe(true);
    expect(response.body).not.toMatch(/access.?token|refresh.?token|client.?secret|password|credential/i);
    await app.close();
  });
});
