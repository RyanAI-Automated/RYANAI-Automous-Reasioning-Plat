import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ listTasks: vi.fn(), cancelTask: vi.fn() }));
vi.mock('../../scheduler/taskStore.js', () => store);

import { tasksRoutes } from './tasks.js';

const taskId = '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11';
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest('authUser', null);
  // Stand-in for the real authentication hook: a header names the signed-in user.
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    (request as unknown as { authUser: unknown }).authUser = id
      ? { id: String(id), role: 'user' }
      : null;
  });
  await app.register(tasksRoutes);
});

afterAll(() => app.close());
beforeEach(() => vi.clearAllMocks());

describe('GET /api/tasks', () => {
  it('refuses a request without a signed-in user', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/tasks' });
    expect(response.statusCode).toBe(401);
    expect(store.listTasks).not.toHaveBeenCalled();
  });

  it('returns the tasks of the signed-in user', async () => {
    store.listTasks.mockResolvedValue([{ id: taskId, status: 'active' }]);
    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { 'x-test-user': 'user-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(store.listTasks).toHaveBeenCalledWith('user-1');
    expect(response.json()).toEqual({ tasks: [{ id: taskId, status: 'active' }] });
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('refuses a request without a signed-in user', async () => {
    const response = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskId}` });
    expect(response.statusCode).toBe(401);
    expect(store.cancelTask).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a UUID', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/not-an-id',
      headers: { 'x-test-user': 'user-1' },
    });
    expect(response.statusCode).toBe(400);
    expect(store.cancelTask).not.toHaveBeenCalled();
  });

  it('returns 404 when the user has no such active task', async () => {
    store.cancelTask.mockResolvedValue(false);
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}`,
      headers: { 'x-test-user': 'user-2' },
    });
    expect(response.statusCode).toBe(404);
    expect(store.cancelTask).toHaveBeenCalledWith('user-2', taskId);
  });

  it('cancels a task of the signed-in user', async () => {
    store.cancelTask.mockResolvedValue(true);
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}`,
      headers: { 'x-test-user': 'user-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cancelled: true });
  });
});
