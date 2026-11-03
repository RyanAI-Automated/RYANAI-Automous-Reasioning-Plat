import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { SelfPatchSkill } from '../../engine/selfPatchSkill.js';
import type { PatchRequest } from '../../engine/selfPatchSkill.js';
import { jarvisClient, JarvisIntegrationError, type JarvisPatchSubmission } from '../../integrations/jarvis/client.js';
import { buildRyanAIStackManifest, type StackEnvironment } from '../../integrations/jarvis/stackManifest.js';
import { requireAdmin } from './auth.js';

type PatchBody = Omit<JarvisPatchSubmission, 'requestedBy'>;
interface StackBody {
  environment: StackEnvironment;
  branch?: string;
  commitSha?: string;
}

type PatchApplyBody = PatchRequest;

async function requireJarvisIngressAuth(request: FastifyRequest, reply: FastifyReply) {
  if (process.env.JARVIS_PATCH_INGRESS_ENABLED !== 'true') {
    return reply.code(404).send({ success: false, error: 'Jarvis patch ingress is disabled.' });
  }
  const expected = process.env.JARVIS_INGRESS_TOKEN?.trim();
  if (!expected) {
    return reply.code(503).send({ success: false, error: 'Jarvis ingress token is not configured.' });
  }
  const authorization = request.headers.authorization || '';
  const supplied = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] || '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return reply.code(401).send({ success: false, error: 'Invalid Jarvis ingress credentials.' });
  }
}

function errorResponse(reply: FastifyReply, error: unknown) {
  const statusCode = error instanceof JarvisIntegrationError ? error.statusCode : 502;
  const message = error instanceof Error ? error.message : 'Jarvis bridge request failed.';
  return reply.code(statusCode).send({ success: false, error: message });
}

function summarizeReceipt(receipt: {
  accepted: boolean;
  statusCode: number;
  remoteId?: string;
  remoteStatus?: string;
  submittedAt: string;
}) {
  return {
    accepted: receipt.accepted,
    statusCode: receipt.statusCode,
    remoteId: receipt.remoteId,
    remoteStatus: receipt.remoteStatus,
    submittedAt: receipt.submittedAt,
  };
}

function proposalStatusCode(status: string) {
  if (status === 'proposed') return 202;
  if (status === 'conflict') return 409;
  if (status === 'rejected') return 422;
  return 503;
}

/** All routes are administrator-only; inbound machine ingress remains fail-closed. */
export const jarvisRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/jarvis/status', { preHandler: requireAdmin }, async () => jarvisClient.status());

  fastify.post<{ Body: PatchBody }>('/api/jarvis/patches', { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body;
    if (
      !body ||
      typeof body.title !== 'string' ||
      typeof body.targetPath !== 'string' ||
      typeof body.patchContent !== 'string' ||
      typeof body.branch !== 'string' ||
      typeof body.baseBranch !== 'string'
    ) {
      return reply.code(400).send({
        success: false,
        error: 'title, targetPath, patchContent, branch, and baseBranch are required strings.',
      });
    }

    try {
      const receipt = await jarvisClient.submitPatch({
        ...body,
        requestedBy: request.authUser?.id || 'admin',
      });
      return reply.code(202).send({ success: true, receipt: summarizeReceipt(receipt) });
    } catch (error: unknown) {
      return errorResponse(reply, error);
    }
  });

  fastify.post<{ Body: StackBody }>('/api/jarvis/stacks/publish', { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body;
    if (
      !body ||
      !['development', 'staging', 'production'].includes(body.environment) ||
      (body.branch !== undefined && typeof body.branch !== 'string') ||
      (body.commitSha !== undefined && typeof body.commitSha !== 'string')
    ) {
      return reply.code(400).send({
        success: false,
        error: 'environment must be development, staging, or production; branch and commitSha are optional strings.',
      });
    }

    try {
      const manifest = buildRyanAIStackManifest(body.environment, {
        branch: body.branch,
        commitSha: body.commitSha,
      });
      const receipt = await jarvisClient.publishStack(manifest);
      return reply.code(202).send({ success: true, receipt: summarizeReceipt(receipt) });
    } catch (error: unknown) {
      return errorResponse(reply, error);
    }
  });

  fastify.post<{ Body: PatchApplyBody }>(
    '/api/jarvis/patches/apply',
    {
      preHandler: requireJarvisIngressAuth,
      schema: {
        body: {
          type: 'object',
          required: ['filePath', 'patchContent'],
          // Fastify's default Ajv setting removes unknown properties when this is false.
          // Keep them intact here so the handler can reject them instead of silently
          // accepting a different payload than the caller submitted.
          additionalProperties: true,
          properties: {
            filePath: { type: 'string', minLength: 1, maxLength: 500 },
            patchContent: { type: 'string', minLength: 1, maxLength: 200_000 },
            testScript: { type: 'string', maxLength: 500 },
          },
        },
      },
      config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const allowedFields = new Set(['filePath', 'patchContent', 'testScript']);
      const submittedFields = Object.keys(request.body ?? {});
      if (submittedFields.some((field) => !allowedFields.has(field))) {
        return reply.code(400).send({
          success: false,
          error: 'Patch payload contains unsupported fields.',
        });
      }

      try {
        // Jarvis may propose a bounded GitHub PR; it must never mutate the live workspace.
        const result = await SelfPatchSkill.proposePullRequest(request.body);
        return reply.code(proposalStatusCode(result.status)).send({
          success: result.status === 'proposed',
          result,
        });
      } catch (error: unknown) {
        request.log.error({ err: error }, 'Jarvis patch proposal failed');
        return reply.code(503).send({
          success: false,
          error: 'Jarvis patch proposal service is unavailable; no patch was promoted.',
        });
      }
    },
  );
};
