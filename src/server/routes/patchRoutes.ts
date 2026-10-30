import type { FastifyPluginAsync } from 'fastify';
import { SelfPatchSkill } from '../../engine/selfPatchSkill.js';
import { requireAdmin } from './auth.js';

interface PatchApplyBody {
  filePath: string;
  patchContent: string;
}

/**
 * Administrator-only production patch proposal endpoint.
 * Candidate code is committed to an isolated GitHub branch and opened as a PR.
 * Repository CI and branch protection gate merge and deployment.
 */
export const registerPatchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: PatchApplyBody }>(
    '/api/patches/apply',
    {
      preHandler: requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['filePath', 'patchContent'],
          additionalProperties: false,
          properties: {
            filePath: { type: 'string', minLength: 1, maxLength: 500 },
            patchContent: { type: 'string', minLength: 1, maxLength: 8 * 1024 * 1024 },
            },
        },
      },
      config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      try {
        const result = await SelfPatchSkill.proposePullRequest(request.body);
        const statusCode =
          result.status === 'proposed' ? 202 :
          result.status === 'conflict' ? 409 :
          result.status === 'rejected' ? 422 : 503;
        return reply.code(statusCode).send({
          success: result.status === 'proposed',
          result,
        });
      } catch (error: unknown) {
        request.log.error({ err: error }, '[SelfPatch] Patch execution failed');
        return reply.code(503).send({
          success: false,
          error: error instanceof Error ? error.message : 'Self-patch verification is unavailable.',
        });
      }
    },
  );
};
