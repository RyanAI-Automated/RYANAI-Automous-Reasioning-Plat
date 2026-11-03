import { createClient } from '@supabase/supabase-js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { requireAdmin } from './auth.js';

type AdminRole = 'user' | 'admin';
type RoleChangeRequest = FastifyRequest<{ Params: { userId: string }; Body: { role: AdminRole } }>;
type IdentityAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type IdentityUser = Awaited<ReturnType<IdentityAdmin['auth']['admin']['getUserById']>>['data']['user'];

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function isConfiguredOwner(email?: string): boolean {
  const ownerEmail = process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(email && ownerEmail && email.toLowerCase() === ownerEmail);
}

async function findTargetUser(admin: IdentityAdmin, userId: string, reply: FastifyReply) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    reply.code(404).send({ error: 'Identity provider user was not found.' });
    return null;
  }
  return data.user;
}

function validateOwnerRoleChange(user: NonNullable<IdentityUser>, requestedRole: AdminRole, reply: FastifyReply): boolean {
  if (!isConfiguredOwner(user.email) || requestedRole === 'admin') return true;
  reply.code(409).send({ error: 'The configured owner account cannot be demoted through this endpoint.' });
  return false;
}

function getCurrentRole(user: NonNullable<IdentityUser>): AdminRole {
  return user.app_metadata?.role === 'admin' ? 'admin' : 'user';
}

async function recordRoleAudit(
  actorId: string,
  target: NonNullable<IdentityUser>,
  eventType: string,
  details: Record<string, unknown>,
  request: RoleChangeRequest,
): Promise<boolean> {
  try {
    await prisma.jarvisAuditEvent.create({
      data: { actorId, eventType, resourceId: target.id, details },
    });
    return true;
  } catch (error) {
    request.log.error({ err: error }, 'Could not persist role-change audit event');
    return false;
  }
}

async function applyIdentityRole(admin: IdentityAdmin, target: NonNullable<IdentityUser>, role: AdminRole, request: RoleChangeRequest): Promise<boolean> {
  const { data, error } = await admin.auth.admin.updateUserById(target.id, {
    app_metadata: { ...(target.app_metadata ?? {}), role },
  });
  if (error || !data.user) {
    request.log.error({ err: error }, 'Supabase Auth role update failed');
    return false;
  }
  return true;
}

async function changeUserRole(request: RoleChangeRequest, reply: FastifyReply): Promise<unknown> {
  if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Only the server-verified configured owner can change administrator roles.' });
  const admin = getSupabaseAdmin();
  if (!admin) return reply.code(503).send({ error: 'Server-side identity administration is not configured.' });

  const target = await findTargetUser(admin, request.params.userId, reply);
  if (!target) return;
  if (!validateOwnerRoleChange(target, request.body.role, reply)) return;

  const previousRole = getCurrentRole(target);
  if (previousRole === request.body.role) return { success: true, changed: false, role: previousRole };

  const auditDetails = { previousRole, requestedRole: request.body.role, targetEmail: target.email ?? null };
  const auditRecorded = await recordRoleAudit(request.authUser.id, target, 'admin.user_role.change_requested', auditDetails, request);
  if (!auditRecorded) return reply.code(503).send({ error: 'Role change was not attempted because its audit record could not be persisted.' });

  const roleUpdated = await applyIdentityRole(admin, target, request.body.role, request);
  if (!roleUpdated) return reply.code(502).send({ error: 'Identity provider role update failed. The audit intent was retained.' });

  const completionRecorded = await recordRoleAudit(
    request.authUser.id,
    target,
    'admin.user_role.changed',
    { previousRole, role: request.body.role, targetEmail: target.email ?? null },
    request,
  );
  if (!completionRecorded) {
    return reply.code(503).send({ error: 'Role changed at the identity provider, but the completion audit record failed. Review the preceding change-request event.' });
  }
  return { success: true, changed: true, role: request.body.role };
}

export const adminUserRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/api/admin/users', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
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
        isConfiguredOwner: isConfiguredOwner(user.email),
      })),
      pageSize: 100,
      hasMore: Boolean(data.nextPage),
      canManageRoles: request.authUser?.isOwner === true,
    };
  });

  fastify.patch<{ Params: { userId: string }; Body: { role: AdminRole } }>('/api/admin/users/:userId/role', {
    schema: {
      params: { type: 'object', required: ['userId'], additionalProperties: false, properties: { userId: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['role'], additionalProperties: false, properties: { role: { type: 'string', enum: ['user', 'admin'] } } },
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, changeUserRole);
};
