import { createClient } from '@supabase/supabase-js';
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { requireAdmin } from './auth.js';

type AdminRole = 'user' | 'admin';

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const adminUserRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/api/admin/users', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    const admin = getSupabaseAdmin();
    if (!admin) return reply.code(503).send({ error: 'Server-side identity administration is not configured.' });
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (error) {
      fastify.log.error({ err: error }, 'Could not list Supabase Auth users');
      return reply.code(502).send({ error: 'Identity provider user listing is unavailable.' });
    }
    return {
      users: data.users.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        role: user.app_metadata?.role === 'admin' ? 'admin' : 'user',
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        isConfiguredOwner: Boolean(
          user.email &&
          process.env.RYANAI_OWNER_EMAIL?.trim() &&
          user.email.toLowerCase() === process.env.RYANAI_OWNER_EMAIL.trim().toLowerCase()
        ),
      })),
      pageSize: 100,
      hasMore: Boolean(data.nextPage),
    };
  });

  fastify.patch<{ Params: { userId: string }; Body: { role: AdminRole } }>('/api/admin/users/:userId/role', {
    schema: {
      params: { type: 'object', required: ['userId'], additionalProperties: false, properties: { userId: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['role'], additionalProperties: false, properties: { role: { type: 'string', enum: ['user', 'admin'] } } },
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!request.authUser?.isOwner) {
      return reply.code(403).send({ error: 'Only the server-verified configured owner can change administrator roles.' });
    }
    const admin = getSupabaseAdmin();
    if (!admin) return reply.code(503).send({ error: 'Server-side identity administration is not configured.' });

    const { data: current, error: lookupError } = await admin.auth.admin.getUserById(request.params.userId);
    if (lookupError || !current.user) {
      return reply.code(404).send({ error: 'Identity provider user was not found.' });
    }
    const ownerEmail = process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase();
    const isConfiguredOwner = Boolean(current.user.email && ownerEmail && current.user.email.toLowerCase() === ownerEmail);
    if (isConfiguredOwner && request.body.role !== 'admin') {
      return reply.code(409).send({ error: 'The configured owner account cannot be demoted through this endpoint.' });
    }
    const previousRole: AdminRole = current.user.app_metadata?.role === 'admin' ? 'admin' : 'user';
    if (previousRole === request.body.role) return { success: true, changed: false, role: previousRole };

    try {
      await prisma.jarvisAuditEvent.create({
        data: {
          actorId: request.authUser.id,
          eventType: 'admin.user_role.change_requested',
          resourceId: current.user.id,
          details: { previousRole, requestedRole: request.body.role, targetEmail: current.user.email ?? null },
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Could not persist role-change audit intent');
      return reply.code(503).send({ error: 'Role change was not attempted because its audit record could not be persisted.' });
    }

    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(current.user.id, {
      app_metadata: { ...(current.user.app_metadata ?? {}), role: request.body.role },
    });
    if (updateError || !updated.user) {
      request.log.error({ err: updateError }, 'Supabase Auth role update failed');
      return reply.code(502).send({ error: 'Identity provider role update failed. The audit intent was retained.' });
    }

    try {
      await prisma.jarvisAuditEvent.create({
        data: {
          actorId: request.authUser.id,
          eventType: 'admin.user_role.changed',
          resourceId: current.user.id,
          details: { previousRole, role: request.body.role, targetEmail: current.user.email ?? null },
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Role changed but completion audit could not be persisted');
      return reply.code(503).send({ error: 'Role changed at the identity provider, but the completion audit record failed. Review the preceding change-request event.' });
    }

    return { success: true, changed: true, role: request.body.role };
  });
};
