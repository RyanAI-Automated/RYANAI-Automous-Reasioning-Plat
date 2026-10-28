import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { SelfPatchSkill } from '../../engine/selfPatchSkill.js';
import { jarvisClient, JarvisIntegrationError, type JarvisPatchSubmission } from '../../integrations/jarvis/client.js';
import { buildRyanAIStackManifest, type StackEnvironment } from '../../integrations/jarvis/stackManifest.js';
import { requireAdmin } from './auth.js';

interface PatchBody extends Omit<JarvisPatchSubmission, 'requestedBy'> {}
interface StackBody {
  environment: StackEnvironment;
  branch?: string;
  commitSha?: string;
}

interface PatchApplyBody {
  filePath: string;
  patchContent: string;
  testScript?: string;
}

async function requireJarvisIngressAuth(request: FastifyRequest, reply: FastifyReply) {
  if (process.env.JARVIS_PATCH_INGRESS_ENABLED !== 'true') {
    return reply.code(404).send({ success: false, error: 'Jarvis patch ingress is disabled.' });
  }
  const expected = process.env.JARVIS_INGRESS_TOKEN?.trim();
  if (!expected) {
    return reply.code(503).send({ success: false, error: 'Jarvis ingress token is not configured.' });
  }
  const authorization = request.headers.authorization || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
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

/** All routes are administrator-only; outbound sync stays disabled by default. */
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
    { preHandler: requireJarvisIngressAuth },
    async (request, reply) => {
      const body = request.body;
      if (
        !body ||
        typeof body.filePath !== 'string' ||
        typeof body.patchContent !== 'string' ||
        (body.testScript !== undefined && typeof body.testScript !== 'string') ||
        body.patchContent.length > 200_000
      ) {
        return reply.code(400).send({ success: false, error: 'filePath and patchContent are required; testScript is optional and patchContent is limited to 200,000 characters.' });
      }
      try {
        const result = await SelfPatchSkill.applyAndVerifyPatch({
          filePath: body.filePath,
          patchContent: body.patchContent,
          testScript: body.testScript,
        });
        const statusCode = result.status === 'success' ? 200 : result.status === 'conflict' ? 409 : result.status === 'rejected' ? 422 : 500;
        return reply.code(statusCode).send({ success: result.status === 'success', result });
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Jarvis incoming patch failed');
        return reply.code(500).send({ success: false, error: error instanceof Error ? error.message : 'Jarvis patch application failed.' });
      }
    },
  );
};