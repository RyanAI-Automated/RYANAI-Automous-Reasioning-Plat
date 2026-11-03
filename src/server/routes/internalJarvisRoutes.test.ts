import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { buildAgentTaskScope, containsTaskCommentSecretMaterial } from './taskCommentSecurity.js';

const mocks = vi.hoisted(() => ({
  prisma: {
    agentRun: { findMany: vi.fn(), findFirst: vi.fn() },
    jarvisAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    agentRun: { findFirst: vi.fn() },
    jarvisAuditEvent: { create: vi.fn() },
  },
  appendRunEvidence: vi.fn(),
  dispatchJarvisTask: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../agent/operations.js', () => ({
  dispatchJarvisTask: mocks.dispatchJarvisTask,
  listAgentRuns: vi.fn(),
}));
vi.mock('../../agent/engineeringEvidence.js', () => ({
  appendRunEvidence: mocks.appendRunEvidence,
}));

import { internalJarvisRoutes } from './internalJarvisRoutes.js';

describe('task comment credential screening', () => {
  it.each([
    'ghp_abcdefghijklmnopqrstuvwxyz123456',
    'github_pat_abcdefghijklmnopqrstuvwxyz123456',
    'sk-abcdefghijklmnopqrstuvwxyz123456',
    'nvapi-abcdefghijklmnopqrstuvwxyz123456',
    '-----BEGIN PRIVATE KEY-----',
    'DATABASE_' + 'URL=placeholder-value',
    'SUPABASE_SERVICE_ROLE_KEY=super-secret-value',
  ])('rejects likely credential material: %s', (value) => {
    expect(containsTaskCommentSecretMaterial(value)).toBe(true);
  });

  it.each([
    'The API returned a 503 and I am investigating.',
    'Please review the deployment workflow before merge.',
    'The DATABASE_URL variable is required in production.',
    'The prefix sk- is used by some API credentials.',
  ])('allows ordinary progress text: %s', (value) => {
    expect(containsTaskCommentSecretMaterial(value)).toBe(false);
  });
});

describe('scoped agent task ownership', () => {
  it('limits machine reads to the configured owner and explicit handoff recipient', () => {
    expect(buildAgentTaskScope('owner-uuid', 'primary')).toEqual({
      userId: 'owner-uuid',
      handoffs: { some: { toAgent: 'primary' } },
    });
  });
});

describe('Jarvis machine task API contract', () => {
  const originalEnv = {
    enabled: process.env.JARVIS_TASK_INGRESS_ENABLED,
    token: process.env.JARVIS_TASK_INGRESS_TOKEN,
    agent: process.env.JARVIS_TASK_AGENT_ID,
    owner: process.env.JARVIS_TASK_OWNER_ID,
  };
  const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const token = 'test-task-ingress-token-0123456789abcdef';
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.JARVIS_TASK_INGRESS_ENABLED = 'true';
    process.env.JARVIS_TASK_INGRESS_TOKEN = token;
    process.env.JARVIS_TASK_AGENT_ID = 'primary';
    process.env.JARVIS_TASK_OWNER_ID = ownerId;
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.appendRunEvidence.mockResolvedValue({
      id: 'evidence-1',
      sequence: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    app = Fastify();
    await app.register(internalJarvisRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      const envKey = {
        enabled: 'JARVIS_TASK_INGRESS_ENABLED',
        token: 'JARVIS_TASK_INGRESS_TOKEN',
        agent: 'JARVIS_TASK_AGENT_ID',
        owner: 'JARVIS_TASK_OWNER_ID',
      }[key]!;
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  });

  it('rejects machine reads when ingress is disabled', async () => {
    process.env.JARVIS_TASK_INGRESS_ENABLED = 'false';
    const response = await app.inject({ method: 'GET', url: '/api/jarvis/agent/tasks', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(404);
    expect(mocks.prisma.agentRun.findMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid machine token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/jarvis/agent/tasks', headers: { authorization: 'Bearer invalid-token' } });
    expect(response.statusCode).toBe(401);
    expect(mocks.prisma.agentRun.findMany).not.toHaveBeenCalled();
  });

  it('reads only tasks owned by the configured owner and handed to the configured agent', async () => {
    mocks.prisma.agentRun.findMany.mockResolvedValue([]);
    const response = await app.inject({ method: 'GET', url: '/api/jarvis/agent/tasks', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.agentRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: ownerId, handoffs: { some: { toAgent: 'primary' } } },
    }));
    expect(response.json()).toEqual({ agentId: 'primary', tasks: [] });
  });

  it('rejects unowned or unassigned task comments without writing evidence or audit rows', async () => {
    mocks.tx.agentRun.findFirst.mockResolvedValue(null);
    const response = await app.inject({
      method: 'POST',
      url: `/api/jarvis/agent/tasks/${taskId}/comments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { comment: 'Progress update' },
    });
    expect(response.statusCode).toBe(404);
    expect(mocks.tx.agentRun.findFirst).toHaveBeenCalledWith({ where: { id: taskId, userId: ownerId, handoffs: { some: { toAgent: 'primary' } } }, select: { id: true } });
    expect(mocks.appendRunEvidence).not.toHaveBeenCalled();
    expect(mocks.tx.jarvisAuditEvent.create).not.toHaveBeenCalled();
  });

  it('writes comment evidence and its audit record inside the same transaction', async () => {
    mocks.tx.agentRun.findFirst.mockResolvedValue({ id: taskId });
    const response = await app.inject({
      method: 'POST',
      url: `/api/jarvis/agent/tasks/${taskId}/comments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { comment: 'Primary analysis is complete.' },
    });
    expect(response.statusCode).toBe(201);
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.appendRunEvidence).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      runId: taskId,
      eventType: 'task.comment',
      actorId: 'agent:primary',
      payload: { comment: 'Primary analysis is complete.', agentId: 'primary' },
    }));
    expect(mocks.tx.jarvisAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'agent:primary',
        eventType: 'task.comment',
        resourceId: taskId,
        details: expect.objectContaining({ evidenceSequence: 1, source: 'scoped-mcp-ingress' }),
      }),
    });
  });

  it('rejects credential-bearing comments before opening a transaction', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/jarvis/agent/tasks/${taskId}/comments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { comment: 'OPENAI_API_KEY=super-secret-value' },
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
