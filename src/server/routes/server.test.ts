import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

const applications: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe('legacy patch server', () => {
  it('keeps health public', async () => {
    const app = await buildServer();
    applications.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'healthy' });
  });

  it('rejects unauthenticated patch requests before patch processing', async () => {
    const app = await buildServer();
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/patches/apply',
      payload: {
        filePath: 'src/example.ts',
        patchContent: 'export const value = 1;',
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'Sign in to continue.' });
  });
});
