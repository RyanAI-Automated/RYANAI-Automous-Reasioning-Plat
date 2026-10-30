import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const operations = vi.hoisted(() => ({
  dispatchAutonomousTask: vi.fn(),
  listAgentRuns: vi.fn(),
  listBrainHealth: vi.fn(),
  probeAllBrains: vi.fn(),
}));
vi.mock('../../agent/operations.js', () => operations);
import { agentOperationsRoutes } from './agentOperations.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    (request as unknown as { authUser: unknown }).authUser = id ? { id: String(id), role: 'user' } : null;
  });
  await app.register(agentOperationsRoutes);
});
afterAll(() => app.close());
beforeEach(() => vi.clearAllMocks());

describe('agent operations routes', () => {
  it('requires authentication before dispatch', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/agent/ops/tasks', payload: { objective: 'Run a test task' } });
    expect(response.statusCode).toBe(401);
    expect(operations.dispatchAutonomousTask).not.toHaveBeenCalled();
  });
  it('dispatches ordinary reasoning autonomously for the authenticated user', async () => {
    operations.dispatchAutonomousTask.mockResolvedValue({ id: 'run-1', status: 'completed', result: 'done' });
    const response = await app.inject({ method: 'POST', url: '/api/agent/ops/tasks', headers: { 'x-test-user': 'user-1' }, payload: { objective: 'Analyze this architecture' } });
    expect(response.statusCode).toBe(200);
    expect(operations.dispatchAutonomousTask).toHaveBeenCalledWith('user-1', 'Analyze this architecture');
    expect(response.json().status).toBe('completed');
  });
  it('rejects objectives shorter than the API contract', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/agent/ops/tasks', headers: { 'x-test-user': 'user-1' }, payload: { objective: 'no' } });
    expect(response.statusCode).toBe(400);
    expect(operations.dispatchAutonomousTask).not.toHaveBeenCalled();
  });
  it('scopes execution history to the authenticated user', async () => {
    operations.listAgentRuns.mockResolvedValue([]);
    const response = await app.inject({ method: 'GET', url: '/api/agent/ops/tasks', headers: { 'x-test-user': 'user-2' } });
    expect(response.statusCode).toBe(200);
    expect(operations.listAgentRuns).toHaveBeenCalledWith('user-2');
  });
});
