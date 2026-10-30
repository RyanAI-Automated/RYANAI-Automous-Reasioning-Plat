import type { FastifyPluginAsync } from 'fastify';
import { dispatchAutonomousTask, listAgentRuns, listBrainHealth, probeAllBrains } from '../../agent/operations.js';
import { listBrainKnowledge, publishBrainKnowledge } from '../../agent/knowledgeAgent.js';
interface DispatchBody { objective: string; }
export const agentOperationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/agent/ops/knowledge', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    return { knowledge: await listBrainKnowledge() };
  });
  fastify.post<{ Body: { title: string; content: string; source?: string; category?: string; tags?: string[]; confidence?: number; priority?: number; expiresAt?: string } }>('/api/agent/ops/knowledge', {
    schema: {
      body: {
        type: 'object', required: ['title', 'content'], additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 200 },
          content: { type: 'string', minLength: 20, maxLength: 12000 },
          source: { type: 'string', maxLength: 500 },
          category: { type: 'string', maxLength: 80 },
          tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          priority: { type: 'integer', minimum: 0, maximum: 100 },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    const { expiresAt, ...input } = request.body;
    try {
      const item = await publishBrainKnowledge({ ...input, expiresAt: expiresAt ? new Date(expiresAt) : null });
      return reply.code(201).send({ success: true, knowledge: item });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : 'Invalid knowledge item.' });
    }
  });
  fastify.get('/api/agent/ops/brains', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { brains: await listBrainHealth() };
  });
  fastify.post('/api/agent/ops/brains/probe', {
    config: { rateLimit: { max: 1, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    return { brains: await probeAllBrains() };
  });
  fastify.post<{ Body: DispatchBody }>('/api/agent/ops/tasks', {
    schema: { body: { type: 'object', required: ['objective'], additionalProperties: false, properties: { objective: { type: 'string', minLength: 5, maxLength: 20000 } } } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    try {
      const task = await dispatchAutonomousTask(request.authUser.id, request.body.objective.trim());
      return reply.code(202).send({ success: true, taskId: task.id, status: task.status, createdAt: task.createdAt });
    } catch (error) {
      fastify.log.error({ err: error }, 'Autonomous agent task enqueue failed');
      return reply.code(503).send({ status: 'failed', error: 'Task could not be queued. Inspect database and worker health.' });
    }
  });
  fastify.get('/api/agent/ops/tasks', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { tasks: await listAgentRuns(request.authUser.id) };
  });
};
