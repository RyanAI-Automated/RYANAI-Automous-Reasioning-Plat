import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from '../server/routes/auth.js';

const BRIDGE_TOPICS = ['telemetry', 'logs', 'tasks', 'agent.status', 'notifications'];

export async function bridgeTicketRoutes(fastify: FastifyInstance) {
  fastify.post('/api/bridge/ticket', {
    preValidation: requireAdmin,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const subject = request.authUser?.id;
    const baseUrl = process.env.BRIDGE_INTERNAL_URL?.replace(/\/+$/, '');
    const issuerToken = process.env.BRIDGE_ISSUER_TOKEN;
    if (!subject) return reply.code(401).send({ error: 'Authentication required' });
    if (!baseUrl || !issuerToken) return reply.code(503).send({ error: 'Connectivity bridge is not configured' });
    try {
      const response = await fetch(baseUrl + '/internal/tickets', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + issuerToken, 'content-type': 'application/json' },
        body: JSON.stringify({ subject, topics: BRIDGE_TOPICS, ttlSeconds: 60 }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return reply.code(503).send({ error: 'Connectivity bridge ticket service unavailable' });
      const result = await response.json() as { ticket?: string; expiresAt?: number };
      if (typeof result.ticket !== 'string' || typeof result.expiresAt !== 'number') {
        return reply.code(503).send({ error: 'Connectivity bridge returned an invalid ticket' });
      }
      reply.header('cache-control', 'no-store');
      return reply.send(result);
    } catch {
      return reply.code(503).send({ error: 'Connectivity bridge is unavailable' });
    }
  });
}
