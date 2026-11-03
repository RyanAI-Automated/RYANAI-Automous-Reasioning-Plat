import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { dispatchJarvisTask, listAgentRuns } from '../../agent/operations.js';
import { authorizeJarvisCapability, getJarvisAgentRegistry, type JarvisCapability } from '../../agent/jarvisRegistry.js';
import { prisma } from '../../lib/prisma.js';
import { appendRunEvidence } from '../../agent/engineeringEvidence.js';

interface CreateTaskBody { objective: string; }
interface TaskCommentBody { comment: string; }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const containsSecretMaterial = (value: string) =>
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value)
  || /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/.test(value)
  || /\b(?:DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|OPENAI_API_KEY|NVIDIA_API_KEY|QWEN_API_KEY|LOGIC_API_KEY|REDIS_URL)\s*=\s*\\S+/i.test(value);

async function requireJarvisTaskAgentAuth(request: FastifyRequest, reply: FastifyReply) {
  if (process.env.JARVIS_TASK_INGRESS_ENABLED !== 'true') {
    return reply.code(404).send({ error: 'Agent task ingress is disabled.' });
  }
  const expected = process.env.JARVIS_TASK_INGRESS_TOKEN?.trim() ?? '';
  const agentId = process.env.JARVIS_TASK_AGENT_ID?.trim() ?? '';
  const ownerId = process.env.JARVIS_TASK_OWNER_ID?.trim() ?? '';
  if (expected.length < 32 || !agentId || !ownerId) {
    return reply.code(503).send({ error: 'Scoped agent task ingress is not fully configured.' });
  }
  const supplied = /^Bearer ([^\\s]+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return reply.code(401).send({ error: 'Invalid agent task credentials.' });
  }
}

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

  // Scoped machine ingress: read and comment only. Worker claims and status transitions remain server-owned.
  fastify.get('/api/jarvis/agent/tasks', { preHandler: requireJarvisTaskAgentAuth }, async () => {
    const ownerId = process.env.JARVIS_TASK_OWNER_ID!.trim();
    return { tasks: await listAgentRuns(ownerId) };
  });

  fastify.post<{ Params: { taskId: string }; Body: TaskCommentBody }>('/api/jarvis/agent/tasks/:taskId/comments', {
    preHandler: requireJarvisTaskAgentAuth,
    schema: {
      params: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string', pattern: UUID_PATTERN.source } } },
      body: { type: 'object', required: ['comment'], additionalProperties: false, properties: { comment: { type: 'string', minLength: 1, maxLength: 4000 } } },
    },
  }, async (request, reply) => {
    const comment = request.body.comment.trim();
    if (!comment) return reply.code(400).send({ error: 'A non-empty comment is required.' });
    if (containsSecretMaterial(comment)) return reply.code(400).send({ error: 'Potential credential material detected. Remove secrets before commenting.' });
    const ownerId = process.env.JARVIS_TASK_OWNER_ID!.trim();
    const agentId = process.env.JARVIS_TASK_AGENT_ID!.trim();
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.agentRun.findFirst({
        where: { id: request.params.taskId, userId: ownerId },
        select: { id: true },
      });
      if (!task) return null;
      const event = await appendRunEvidence(tx, {
        runId: task.id,
        eventType: 'task.comment',
        actorId: `agent:${agentId}`,
        payload: { comment, agentId },
      });
      await tx.jarvisAuditEvent.create({
        data: {
          actorId: `agent:${agentId}`,
          eventType: 'task.comment',
          resourceId: task.id,
          details: { evidenceSequence: event.sequence, commentLength: comment.length, source: 'scoped-mcp-ingress' },
        },
      });
      return { id: event.id, sequence: event.sequence, createdAt: event.createdAt };
    });
    if (!result) return reply.code(404).send({ error: 'Task not found for the configured owner.' });
    return reply.code(201).send({ success: true, agentId, comment: result });
  });

  fastify.post<{ Params: { taskId: string }; Body: TaskCommentBody }>('/api/jarvis/internal/tasks/:taskId/comments', {
    schema: {
      params: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string', pattern: UUID_PATTERN.source } } },
      body: { type: 'object', required: ['comment'], additionalProperties: false, properties: { comment: { type: 'string', minLength: 1, maxLength: 4000 } } },
    },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required.' });
    const comment = request.body.comment.trim();
    if (!comment) return reply.code(400).send({ error: 'A non-empty comment is required.' });
    if (containsSecretMaterial(comment)) {
      return reply.code(400).send({ error: 'Potential credential material detected. Remove secrets before commenting.' });
    }
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.agentRun.findFirst({
        where: { id: request.params.taskId, userId: request.authUser!.id },
        select: { id: true },
      });
      if (!task) return null;
      const event = await appendRunEvidence(tx, {
        runId: task.id,
        eventType: 'task.comment',
        actorId: request.authUser!.id,
        payload: { comment },
      });
      await tx.jarvisAuditEvent.create({
        data: {
          actorId: request.authUser!.id,
          eventType: 'task.comment',
          resourceId: task.id,
          details: { evidenceSequence: event.sequence, commentLength: comment.length },
        },
      });
      return { id: event.id, sequence: event.sequence, createdAt: event.createdAt };
    });
    if (!result) return reply.code(404).send({ error: 'Task not found for this account.' });
    return reply.code(201).send({ success: true, comment: result });
  });

  fastify.get('/api/jarvis/internal/policy/:agentId/:capability', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required.' });
    const { agentId, capability } = request.params as { agentId: string; capability: JarvisCapability };
    const decision = authorizeJarvisCapability(agentId, capability);
    return { agentId, capability, ...decision };
  });

  fastify.get('/api/jarvis/internal/audit', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!isAdmin(request)) return reply.code(403).send({ error: 'Administrator access is required.' });
    const events = await prisma.$queryRaw`SELECT id, actor_id AS "actorId", event_type AS "eventType", resource_id AS "resourceId", details, created_at AS "createdAt" FROM "jarvis_audit_events" ORDER BY created_at DESC LIMIT 100`;
    return { events };
  });
};
