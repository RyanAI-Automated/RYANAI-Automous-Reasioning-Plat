import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { requireAdmin } from './auth.js';

export const adminSessionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/api/admin/sessions', async (request) => {
    const sessions = await prisma.apiAuthSession.findMany({
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
      select: { id: true, userId: true, email: true, createdAt: true, lastSeenAt: true, revokedAt: true, sessionId: true },
    });
    return {
      sessions: sessions.map(({ sessionId, ...session }) => ({
        ...session,
        isCurrent: Boolean(request.authUser?.sessionId && request.authUser.sessionId === sessionId),
        status: session.revokedAt ? 'revoked' : 'active',
      })),
      enforcement: 'RyanAI API requests check the verified Supabase session_id against this registry. Revocation blocks this session from RyanAI APIs, including refreshed access tokens carrying the same session_id.',
    };
  });

  fastify.post<{ Params: { id: string } }>('/api/admin/sessions/:id/revoke', {
    schema: { params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    const session = await prisma.apiAuthSession.findUnique({ where: { id: request.params.id } });
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found.' });
    if (request.authUser?.sessionId && session.sessionId === request.authUser.sessionId) {
      return reply.code(409).send({ success: false, error: 'You cannot revoke the session currently performing this request. Sign out normally or use another administrator session.' });
    }
    if (session.revokedAt) return { success: true, status: 'already_revoked' };

    const revokedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.apiAuthSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt },
      });
      if (updated.count === 1) {
        await tx.jarvisAuditEvent.create({
          data: {
            actorId: request.authUser!.id,
            eventType: 'auth.session.revoked',
            resourceId: session.id,
            details: { targetUserId: session.userId, targetEmail: session.email ?? null, enforcement: 'ryanai-api-session-registry' },
          },
        });
      }
      return updated.count;
    });
    if (result !== 1) return reply.code(409).send({ success: false, error: 'Session state changed; refresh the session list.' });
    return { success: true, status: 'revoked', revokedAt };
  });
};
