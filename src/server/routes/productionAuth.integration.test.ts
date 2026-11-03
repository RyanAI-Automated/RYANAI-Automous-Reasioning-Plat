import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin, installAuthentication } from './auth.js';
import { agentOperationsRoutes } from './agentOperations.js';
import { inspectReadiness } from '../readiness.js';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  dispatchAutonomousTask: vi.fn(),
  listAgentRuns: vi.fn(),
  listBrainHealth: vi.fn(),
  probeAllBrains: vi.fn(),
  listBrainKnowledge: vi.fn(),
  publishBrainKnowledge: vi.fn(),
  databaseProbe: vi.fn(),
  redisProbe: vi.fn(),
}));

vi.mock('@supabase/server/core', () => ({
  createContextClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('../../agent/operations.js', () => ({
  dispatchAutonomousTask: mocks.dispatchAutonomousTask,
  listAgentRuns: mocks.listAgentRuns,
  listBrainHealth: mocks.listBrainHealth,
  probeAllBrains: mocks.probeAllBrains,
}));
vi.mock('../../agent/knowledgeAgent.js', () => ({
  listBrainKnowledge: mocks.listBrainKnowledge,
  publishBrainKnowledge: mocks.publishBrainKnowledge,
}));

const apps: FastifyInstance[] = [];
const memberToken = { authorization: 'Bearer verified-member-token' };
const member = {
  id: 'member-uuid',
  email: 'member@example.test',
  app_metadata: {},
  user_metadata: { role: 'admin' },
  is_anonymous: false,
};

async function productionRouteApp() {
  const app = Fastify();
  apps.push(app);
  installAuthentication(app);
  await app.register(authPlugin);
  await app.register(agentOperationsRoutes);

  // Exercise the same readiness evaluator used by the production launcher;
  // only the external dependency probes are replaced with deterministic mocks.
  app.get('/livez', async () => ({ status: 'alive' }));
  app.get('/readyz', async (_request, reply) => {
    const readiness = await inspectReadiness({
      database: mocks.databaseProbe,
      redis: mocks.redisProbe,
      agentCheckpointerInitialized: true,
      apiListening: true,
    });
    reply.code(readiness.ready ? 200 : 503);
    return {
      status: readiness.ready ? 'online' : 'degraded',
      services: readiness.services,
    };
  });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'synthetic-publishable-key');
  mocks.getUser.mockResolvedValue({ data: { user: member }, error: null });
  mocks.dispatchAutonomousTask.mockResolvedValue({
    id: 'task-123',
    status: 'queued',
    createdAt: new Date('2026-11-03T10:00:00.000Z'),
  });
  mocks.listAgentRuns.mockResolvedValue([{ id: 'member-task', userId: member.id }]);
  mocks.listBrainHealth.mockResolvedValue([{ id: 'primary', status: 'unknown' }]);
  mocks.probeAllBrains.mockResolvedValue([]);
  mocks.listBrainKnowledge.mockResolvedValue([]);
  mocks.databaseProbe.mockResolvedValue(undefined);
  mocks.redisProbe.mockResolvedValue(undefined);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('production authentication and agent route integration', () => {
  it('allows a verified member to enqueue a task using the verified user id', async () => {
    const app = await productionRouteApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/ops/tasks',
      headers: memberToken,
      payload: { objective: 'Run a scoped diagnostic task' },
    });

    expect(response.statusCode).toBe(202);
    expect(mocks.dispatchAutonomousTask).toHaveBeenCalledWith(
      member.id,
      'Run a scoped diagnostic task',
    );
  });

  it('scopes task history to the verified member identity', async () => {
    const app = await productionRouteApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/agent/ops/tasks',
      headers: memberToken,
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.listAgentRuns).toHaveBeenCalledWith(member.id);
    expect(response.json().tasks).toEqual([{ id: 'member-task', userId: member.id }]);
  });

  it('allows a verified member to read brain health without granting probe access', async () => {
    const app = await productionRouteApp();
    const read = await app.inject({
      method: 'GET',
      url: '/api/agent/ops/brains',
      headers: memberToken,
    });
    const probe = await app.inject({
      method: 'POST',
      url: '/api/agent/ops/brains/probe',
      headers: memberToken,
    });

    expect(read.statusCode).toBe(200);
    expect(mocks.listBrainHealth).toHaveBeenCalledOnce();
    expect(probe.statusCode).toBe(403);
    expect(mocks.probeAllBrains).not.toHaveBeenCalled();
  });

  it('does not trust admin role claims in editable user metadata', async () => {
    const app = await productionRouteApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/agent/ops/knowledge',
      headers: memberToken,
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.listBrainKnowledge).not.toHaveBeenCalled();
  });

  it('keeps liveness and a genuinely ready service reachable without a browser session', async () => {
    const app = await productionRouteApp();

    const live = await app.inject({ method: 'GET', url: '/livez' });
    const ready = await app.inject({ method: 'GET', url: '/readyz' });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ status: 'alive' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: 'online',
      services: { database: true, redis: true, agentCheckpointer: true, api: true },
    });
    expect(mocks.databaseProbe).toHaveBeenCalledOnce();
    expect(mocks.redisProbe).toHaveBeenCalledOnce();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('returns 503 from readiness when a live dependency probe fails, without requiring a session', async () => {
    const app = await productionRouteApp();
    mocks.redisProbe.mockRejectedValueOnce(new Error('redis://private-password@host'));

    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'degraded',
      services: { database: true, redis: false, agentCheckpointer: true, api: true },
    });
    expect(response.body).not.toContain('private-password');
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('fails closed for task routes when no bearer token is supplied', async () => {
    const app = await productionRouteApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/ops/tasks',
      payload: { objective: 'Run a scoped diagnostic task' },
    });

    expect(response.statusCode).toBe(401);
    expect(mocks.dispatchAutonomousTask).not.toHaveBeenCalled();
  });
});
