import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { audiobookProjectRoutes } from './audiobookProjects.js';

const apps: FastifyInstance[] = [];
const userId = 'audiobook-test-user';

async function createApp(prisma: Record<string, any>) {
  const app = Fastify();
  apps.push(app);
  app.decorate('prisma', prisma);
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    if (request.headers.authorization === 'Bearer test-user') {
      request.authUser = { id: userId, email: 'audio@example.test', role: 'user', isOwner: false };
    }
  });
  await app.register(audiobookProjectRoutes);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('RyanAI audiobook persistence routes', () => {
  it('rejects unauthenticated project listing before querying the database', async () => {
    const findMany = vi.fn();
    const app = await createApp({ audiobookProject: { findMany } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/audiobooks' });
    expect(response.statusCode).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes project listing to the authenticated owner', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = await createApp({ audiobookProject: { findMany } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/audiobooks', headers: { authorization: 'Bearer test-user' } });
    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId } }));
  });

  it('does not disclose another user’s project when an ID is supplied', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const app = await createApp({ audiobookProject: { findFirst } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/audiobooks/foreign-project', headers: { authorization: 'Bearer test-user' } });
    expect(response.statusCode).toBe(404);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign-project', userId } }));
  });

  it('fails closed when provider or private storage credentials are absent', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const findFirst = vi.fn();
    const app = await createApp({ audiobookProject: { findFirst } });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/audiobooks/project-a/render',
      headers: { authorization: 'Bearer test-user' }, payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns an existing owner-scoped render job for a repeated idempotency key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-provider-key');
    vi.stubEnv('SUPABASE_URL', 'https://storage.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');
    const project = {
      id: 'project-a', title: 'Test book', language: 'en-ZA', userId,
      chapters: [{ id: 'chapter-a', title: 'Chapter 1', content: 'Hello world.', narrationSettings: { voice: 'coral', speed: 1, style: '' } }],
    };
    const findFirst = vi.fn().mockResolvedValue(project);
    const existingJob = { id: 'job-existing', status: 'queued', userId };
    const findUnique = vi.fn().mockResolvedValue(existingJob);
    const create = vi.fn();
    const app = await createApp({ audiobookProject: { findFirst }, audiobookRenderJob: { findUnique, create } });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/audiobooks/project-a/render',
      headers: { authorization: 'Bearer test-user' },
      payload: { idempotencyKey: 'render-request-001' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reused: true, job: { id: 'job-existing' } });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'project-a', userId } }));
    expect(findUnique).toHaveBeenCalledWith({ where: { userId_idempotencyKey: { userId, idempotencyKey: 'render-request-001' } } });
    expect(create).not.toHaveBeenCalled();
  });
});
