import type { FastifyPluginAsync } from 'fastify';
import { dispatchAutonomousTask, listAgentRuns, listBrainHealth, probeAllBrains } from '../../agent/operations.js';
interface DispatchBody { objective: string; }
export const agentOperationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/agent/ops/brains', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { brains: await listBrainHealth() };
  });
  fastify.post('/api/agent/ops/brains/probe', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { brains: await probeAllBrains() };
  });
  fastify.post<{ Body: DispatchBody }>('/api/agent/ops/tasks', {
    schema: { body: { type: 'object', required: ['objective'], additionalProperties: false, properties: { objective: { type: 'string', minLength: 5, maxLength: 20000 } } } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    try { return await dispatchAutonomousTask(request.authUser.id, request.body.objective.trim()); }
    catch (error) {
      fastify.log.error({ err: error }, 'Autonomous agent task failed');
      return reply.code(503).send({ status: 'failed', error: 'Task failed. Inspect brain health and execution history.' });
    }
  });
  fastify.get('/api/agent/ops/tasks', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { tasks: await listAgentRuns(request.authUser.id) };
  });
};
