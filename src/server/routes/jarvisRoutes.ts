import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { jarvisClient, JarvisIntegrationError, type JarvisPatchSubmission } from '../../integrations/jarvis/client.js';
import { buildRyanAIStackManifest, type StackEnvironment } from '../../integrations/jarvis/stackManifest.js';
import { requireAdmin } from './auth.js';

interface PatchBody extends Omit<JarvisPatchSubmission, 'requestedBy'> {}
interface StackBody {
  environment: StackEnvironment;
  branch?: string;
  commitSha?: string;
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
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/api/jarvis/status', async () => jarvisClient.status());

  fastify.post<{ Body: PatchBody }>('/api/jarvis/patches', async (request, reply) => {
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

  fastify.post<{ Body: StackBody }>('/api/jarvis/stacks/publish', async (request, reply) => {
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
};