import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SelfPatchSkill } from '../../engine/selfPatchSkill.js';

interface PatchBody {
  filePath: string;
  patchContent: string;
  testScript?: string;
}

export async function registerPatchRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: PatchBody }>(
    '/api/v1/patches/apply',
    {
      schema: {
        body: {
          type: 'object',
          required: ['filePath', 'patchContent'],
          properties: {
            filePath: { type: 'string' },
            patchContent: { type: 'string' },
            testScript: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: PatchBody }>, reply: FastifyReply) => {
      const { filePath, patchContent, testScript } = request.body;

      if (filePath.includes('..') || filePath.startsWith('/')) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid file path: absolute paths and directory traversal are prohibited.',
        });
      }

      try {
        const result = await SelfPatchSkill.applyAndVerifyPatch({
          filePath,
          patchContent,
          testScript,
        });

        if (!result.success) {
          return reply.status(422).send(result);
        }

        return reply.send(result);
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: `Internal patch execution error: ${err.message}`,
        });
      }
    }
  );
}
