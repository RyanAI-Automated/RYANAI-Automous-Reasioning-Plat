import type { FastifyPluginAsync } from 'fastify';
import { SelfPatchSkill } from '../../engine/selfPatchSkill.js';
import { requireAdmin } from './auth.js';

interface PatchApplyBody {
  filePath: string;
  patchContent: string;
  testScript?: string;
}

/**
 * Administrator-only, validate-before-promote self-patching endpoint.
 * Candidate code is staged and verified by the digest-pinned, network-disabled
 * verifier before the workspace patch engine atomically promotes it.
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
            testScript: { type: 'string', maxLength: 200_000 },
          },
        },
      },
      config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      try {
        const result = await SelfPatchSkill.applyAndVerifyPatch(request.body);
        const statusCode =
          result.status === 'success' ? 200 :
          result.status === 'conflict' ? 409 :
          result.status === 'rejected' ? 422 : 503;
        return reply.code(statusCode).send({
          success: result.status === 'success',
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
