import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { listOpenActions } from '../../approvals/pendingStore.js';
import { decideAction } from '../../approvals/service.js';
import { UUID_PATTERN } from '../../scheduler/schedule.js';
import { requireAdmin } from './auth.js';

/**
 * Let an administrator list, approve, and reject the actions that the agent
 * queued. Approving sends the message. Any user's agent can queue an action,
 * and only an administrator can release it.
 */
export const pendingActionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/api/actions', async () => ({ actions: await listOpenActions() }));

  const decide =
    (approve: boolean) =>
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const adminId = request.authUser?.id;
      if (!adminId) return reply.code(401).send({ error: 'Sign in to continue.' });
      const { id } = request.params;
      if (!UUID_PATTERN.test(id)) {
        return reply.code(400).send({ error: 'The action id is not valid.' });
      }

      const result = await decideAction(id, adminId, approve);
      switch (result.outcome) {
        case 'not_found':
          return reply.code(404).send({
            error: 'No pending action has this id. It may be decided already, or it expired.',
          });
        case 'rejected':
          return { status: 'rejected' };
        case 'executed':
          return { status: 'executed', result: result.result };
        case 'failed':
          return reply.code(502).send({ status: 'failed', error: result.error });
      }
    };

  fastify.post<{ Params: { id: string } }>('/api/actions/:id/approve', decide(true));
  fastify.post<{ Params: { id: string } }>('/api/actions/:id/reject', decide(false));
};
