import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const operations = vi.hoisted(() => ({
  dispatchAutonomousTask: vi.fn(),
  listAgentRuns: vi.fn(),
  listBrainHealth: vi.fn(),
  probeAllBrains: vi.fn(),
  listBrainKnowledge: vi.fn(),
  publishBrainKnowledge: vi.fn(),
}));
vi.mock('../../agent/operations.js', () => operations);
vi.mock('../../agent/knowledgeAgent.js', () => ({
  listBrainKnowledge: operations.listBrainKnowledge,
  publishBrainKnowledge: operations.publishBrainKnowledge,
}));
import { agentOperationsRoutes } from './agentOperations.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    const role = request.headers['x-test-role'];
    (request as unknown as { authUser: unknown }).authUser = id ? { id: String(id), role: role === 'admin' ? 'admin' : 'user' } : null;
  });
  await app.register(agentOperationsRoutes);
});
afterAll(() => app.close());
beforeEach(() => vi.clearAllMocks());

describe('agent operations routes', () => {
  it('denies knowledge publication to authenticated non-admin users', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/agent/ops/knowledge',
      headers: { 'x-test-user': 'user-1' },
      payload: { title: 'Platform policy', content: 'A sufficiently detailed knowledge record for the platform.' },
    });
    expect(response.statusCode).toBe(403);
    expect(operations.publishBrainKnowledge).not.toHaveBeenCalled();
  });
  it('allows admins to publish knowledge for all reasoning brains', async () => {
    operations.publishBrainKnowledge.mockResolvedValue({ id: 'knowledge-1', title: 'Platform policy' });
    const response = await app.inject({
      method: 'POST', url: '/api/agent/ops/knowledge',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
      payload: { title: 'Platform policy', content: 'A sufficiently detailed knowledge record for the platform.', tags: ['security'] },
    });
    expect(response.statusCode).toBe(201);
    expect(operations.publishBrainKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Platform policy', tags: ['security'], expiresAt: null,
    }));
  });
  it('lists shared knowledge only for administrators', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/agent/ops/knowledge', headers: { 'x-test-user': 'user-1' } });
    expect(denied.statusCode).toBe(403);
    operations.listBrainKnowledge.mockResolvedValue([{ id: 'knowledge-1' }]);
    const allowed = await app.inject({ method: 'GET', url: '/api/agent/ops/knowledge', headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().knowledge).toHaveLength(1);
  });

  it('restricts live provider probes to administrators', async () => {
    const denied = await app.inject({ method: 'POST', url: '/api/agent/ops/brains/probe', headers: { 'x-test-user': 'user-1' } });
    expect(denied.statusCode).toBe(403);
    expect(operations.probeAllBrains).not.toHaveBeenCalled();
    operations.probeAllBrains.mockResolvedValue([{ brain: 'primary', status: 'HEALTHY' }]);
    const allowed = await app.inject({ method: 'POST', url: '/api/agent/ops/brains/probe', headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' } });
    expect(allowed.statusCode).toBe(200);
    expect(operations.probeAllBrains).toHaveBeenCalledTimes(1);
  });

  it('requires authentication before dispatch', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/agent/ops/tasks', payload: { objective: 'Run a test task' } });
    expect(response.statusCode).toBe(401);
    expect(operations.dispatchAutonomousTask).not.toHaveBeenCalled();
  });
  it('queues work for the authenticated user without waiting for model execution', async () => {
    operations.dispatchAutonomousTask.mockResolvedValue({ id: 'run-1', status: 'queued', createdAt: new Date('2026-10-30T08:00:00.000Z') });
    const response = await app.inject({ method: 'POST', url: '/api/agent/ops/tasks', headers: { 'x-test-user': 'user-1' }, payload: { objective: 'Analyze this architecture' } });
    expect(response.statusCode).toBe(202);
    expect(operations.dispatchAutonomousTask).toHaveBeenCalledWith('user-1', 'Analyze this architecture');
    expect(response.json()).toMatchObject({ taskId: 'run-1', status: 'queued' });
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
