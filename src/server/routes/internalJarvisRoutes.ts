import type { FastifyPluginAsync } from 'fastify';
import { dispatchJarvisTask, listAgentRuns } from '../../agent/operations.js';
import { authorizeJarvisCapability, getJarvisAgentRegistry, type JarvisCapability } from '../../agent/jarvisRegistry.js';
import { prisma } from '../../lib/prisma.js';
import { createJarvisIdentityProof, createPADelegation, getPADelegation, verifyPAHandshake } from '../../agent/paDelegationService.js';

interface CreateTaskBody { objective: string; }

function isAdmin(request: { authUser?: { id: string; role?: string } | null }) {
  return Boolean(request.authUser && request.authUser.role === 'admin');
}

/** Internal Jarvis control-plane API. All writes are audited; privileged tools are never exposed here. */
export const internalJarvisRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/jarvis/internal/health', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { service: 'ryanai-internal-jarvis', status: 'ready', persistence: 'connected', externalJarvisRequired: false };
    } catch {
      return reply.code(503).send({ service: 'ryanai-internal-jarvis', status: 'degraded', persistence: 'unavailable', externalJarvisRequired: false });
    }
  });

  fastify.get('/api/jarvis/internal/agents', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required.' });
    return { agents: getJarvisAgentRegistry() };
  });

  fastify.post<{ Body: CreateTaskBody }>('/api/jarvis/internal/tasks', {
    schema: { body: { type: 'object', required: ['objective'], additionalProperties: false, properties: { objective: { type: 'string', minLength: 5, maxLength: 20000 } } } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required to submit engineering tasks.' });
    const objective = request.body.objective.trim();
    try {
      const task = await dispatchJarvisTask(request.authUser.id, objective);
      return reply.code(202).send({ success: true, taskId: task.id, status: task.status, createdAt: task.createdAt, approvalRequiredForPrivilegedActions: true });
    } catch (error) {
      request.log.error({ err: error }, 'Internal Jarvis task enqueue or audit failed');
      return reply.code(503).send({ success: false, error: 'Jarvis could not atomically persist and audit this task.' });
    }
  });

  fastify.get('/api/jarvis/internal/tasks', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required.' });
    return { tasks: await listAgentRuns(request.authUser.id) };
  });

  fastify.get('/api/jarvis/internal/policy/:agentId/:capability', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required.' });
    const { agentId, capability } = request.params as { agentId: string; capability: JarvisCapability };
    const decision = authorizeJarvisCapability(agentId, capability);
    return { agentId, capability, ...decision };
  });

  fastify.post<{ Body: { identityProof: string; objective: string; capabilities: JarvisCapability[] } }>('/api/jarvis/internal/pa/handshake', {
    schema: { body: { type: 'object', required: ['identityProof', 'objective', 'capabilities'], additionalProperties: false } },
  }, async (request, reply) => {
    try {
      const proof = await verifyPAHandshake(request.body.identityProof);
      if (proof.capabilities.some((capability) => !request.body.capabilities.includes(capability))) {
        return reply.code(403).send({ error: 'Delegated capability scope cannot be expanded by the handshake request.' });
      }
      const delegation = await createPADelegation({
        ownerUserId: proof.ownerUserId,
        delegationId: proof.delegationId,
        objective: request.body.objective,
        capabilities: request.body.capabilities,
        traceId: proof.delegationId,
      });
      const jarvisProof = await createJarvisIdentityProof(proof.ownerUserId, delegation.delegation.id);
      return reply.code(202).send({
        success: true,
        identity: { issuer: 'ryanai-jarvis', audience: 'ryanai-pa', proof: jarvisProof },
        delegation: {
          id: delegation.delegation.id,
          agentRunId: delegation.run.id,
          status: delegation.delegation.status,
          traceId: delegation.delegation.traceId,
        },
      });
    } catch (error) {
      request.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'PA handshake rejected');
      return reply.code(401).send({ error: 'PA identity handshake rejected.' });
    }
  });

  fastify.get<{ Params: { delegationId: string } }>('/api/jarvis/internal/pa/delegations/:delegationId', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required.' });
    const delegation = await getPADelegation(request.authUser.id, request.params.delegationId);
    if (!delegation) return reply.code(404).send({ error: 'Delegation not found.' });
    return { delegation };
  });

  fastify.get('/api/jarvis/internal/audit', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required.' });
    const events = await prisma.$queryRaw`SELECT id, actor_id AS "actorId", event_type AS "eventType", resource_id AS "resourceId", details, created_at AS "createdAt" FROM "jarvis_audit_events" ORDER BY created_at DESC LIMIT 100`;
    return { events };
  });
};
