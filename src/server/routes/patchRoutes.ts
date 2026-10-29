import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdmin } from './auth.js';
import { patchService } from '../../services/patchService.js';
import { PatchRequest, PatchStatus } from '../../types/patch.js';

export async function registerPatchRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAdmin);
  fastify.post(
    '/api/patches/apply',
    async (request: FastifyRequest<{ Body: PatchRequest }>, reply: FastifyReply) => {
      try {
        const patchRequest = request.body;

        // 1. Validate request payload existence
        if (!patchRequest || !patchRequest.targetType || !patchRequest.operations) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid patch request. "targetType" and "operations" are required fields.',
          });
        }

        // 2. Validate operations array
        if (!Array.isArray(patchRequest.operations) || patchRequest.operations.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Operations payload must be a non-empty array.',
          });
        }

        // 3. Attach author if authenticated
        const authUser = (request as FastifyRequest & { user?: { email?: string } }).user;
        if (authUser?.email && !patchRequest.author) {
          patchRequest.author = authUser.email;
        }

        // 4. Execute patch via service
        const result = await patchService.applyPatch(patchRequest);

        // 5. Check result status
        if (result.status === PatchStatus.FAILED) {
          return reply.status(422).send({
            success: false,
            error: result.error || 'Patch execution failed',
            result,
          });
        }

        return reply.status(200).send({
          success: true,
          message: 'Patch applied successfully',
          result,
        });
      } catch (error: unknown) {
        request.log.error({ err: error }, '[PatchRoutes] Unhandled error during patch execution');
        return reply.status(500).send({
          success: false,
          error: error instanceof Error
            ? error.message
            : 'Internal server error while processing patch request',
        });
      }
    }
  );
}