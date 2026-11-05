import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import authSigninRoute from './signin.js';

const apps: FastifyInstance[] = [];

beforeEach(async () => {
  const app = Fastify();
  apps.push(app);
  await app.register(authSigninRoute);
  await app.ready();
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('retired local sign-in compatibility route', () => {
  it.each([
    [{ email: 'member@example.test', password: 'legacy-password' }],
    [{}],
  ])('returns Gone instead of creating a local-password session', async (payload) => {
    const app = apps.at(-1)!;
    const response = await app.inject({
      method: 'POST',
      url: '/signin',
      payload,
    });

    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({
      success: false,
      error: 'Gone',
      message: 'Local password sign-in has been retired. Use Supabase Auth through the RyanAI sign-in page.',
    });
  });
});
