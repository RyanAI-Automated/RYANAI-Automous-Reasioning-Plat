import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerAuthRoutes } from './auth.js';

describe('legacy auth entrypoint compatibility', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('retires legacy signup, signin, and profile routes without creating a JWT session', async () => {
    app = Fastify();
    await registerAuthRoutes(app);
    await app.ready();

    for (const route of [
      { method: 'POST' as const, url: '/api/auth/signup' },
      { method: 'POST' as const, url: '/api/auth/signin' },
      { method: 'GET' as const, url: '/api/auth/me' },
    ]) {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        payload: { email: 'member@example.test', password: 'not-a-real-password' },
      });
      expect(response.statusCode).toBe(410);
      expect(response.json()).not.toHaveProperty('token');
    }
  });
});
