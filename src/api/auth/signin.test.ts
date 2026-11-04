import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import retiredLocalSigninRoute from './signin.js';

describe('retired local sign-in compatibility route', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 410 and never accepts local credentials or issues a token', async () => {
    app = Fastify();
    await app.register(retiredLocalSigninRoute);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/signin',
      payload: { email: 'member@example.test', password: 'not-a-real-password' },
    });

    expect(response.statusCode).toBe(410);
    expect(response.json()).not.toHaveProperty('token');
    expect(response.json().error).toContain('retired');
  });
});
