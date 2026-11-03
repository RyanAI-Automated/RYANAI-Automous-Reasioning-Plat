import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { createContextClient } from '@supabase/server/core';
import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';

interface SigninRequestBody { email: string; password: string; }

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: 'user' | 'admin';
  displayName?: string;
  isOwner: boolean;
}

export function hasAdminAccess(user?: Pick<AuthenticatedUser, 'role' | 'isOwner'> | null): boolean {
  return Boolean(user && (user.role === 'admin' || user.isOwner));
}

declare module 'fastify' {
  interface FastifyRequest { authUser: AuthenticatedUser | null; }
  interface FastifyInstance { prisma: PrismaClient; }
}

/** Verify the bearer token with Supabase; never trust browser-editable role metadata. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser) return;
  const token = /^Bearer ([^\\s]+)$/i.exec(request.headers.authorization || '')?.[1];
  if (!token) return reply.code(401).send({ error: 'Sign in to continue.' });

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return reply.code(503).send({ error: 'Authentication is not configured.' });

  try {
    const client = createContextClient({
      env: { url, publishableKeys: { default: key } },
      auth: { token },
      supabaseOptions: { global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) } },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user || data.user.is_anonymous) {
      const status = error && (!error.status || error.status >= 500) ? 503 : 401;
      return reply.code(status).send({ error: status === 503 ? 'Authentication is temporarily unavailable.' : 'Invalid or expired session. Please sign in again.' });
    }
    const ownerEmail = process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase();
    const sessionId = getVerifiedSessionId(token);
    if (request.server.hasDecorator('prisma')) {
      const session = await request.server.prisma.apiAuthSession.upsert({
        where: { sessionId },
        create: { sessionId, userId: data.user.id, email: data.user.email ?? null },
        update: {},
      });
      if (session.revokedAt) return reply.code(401).send({ error: 'This RyanAI API session has been revoked. Sign in again.' });
      await request.server.prisma.apiAuthSession.updateMany({
        where: { sessionId, revokedAt: null, lastSeenAt: { lt: new Date(Date.now() - 60_000) } },
        data: { lastSeenAt: new Date(), email: data.user.email ?? null },
      });
    }
    request.authUser = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.app_metadata?.role === 'admin' ? 'admin' : 'user',
      displayName: typeof data.user.user_metadata?.full_name === 'string' ? data.user.user_metadata.full_name : undefined,
      isOwner: Boolean(data.user.email && ownerEmail && data.user.email.toLowerCase() === ownerEmail),
      sessionId,
    };
  } catch {
    return reply.code(503).send({ error: 'Authentication is temporarily unavailable.' });
  }
}

function getVerifiedSessionId(token: string): string {
  try {
    const encoded = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { session_id?: unknown };
    if (typeof payload.session_id === 'string' && payload.session_id.length > 0 && payload.session_id.length <= 128) return payload.session_id;
  } catch {
    // Supabase verified the token already; fall back to a token-specific revocation key.
  }
  return createHash('sha256').update(token).digest('hex');
}

/** Owner identity is resolved only from the server-side configured owner email. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (!hasAdminAccess(request.authUser)) return reply.code(403).send({ error: 'Administrator access is required.' });
}

export function installAuthentication(fastify: FastifyInstance) {
  fastify.decorateRequest('authUser', null);
  fastify.addHook('preValidation', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (request.method === 'OPTIONS') return;
    if (request.method === 'POST' && path === '/api/internal/openai/chat') return;
    if (path.startsWith('/api/comms/')) {
      await requireUser(request, reply);
      if (reply.sent) return;
      if (!hasAdminAccess(request.authUser)) return reply.code(403).send({ error: 'Owner or administrator access is required.' });
      return;
    }
    if (request.method === 'POST' && path === '/api/jarvis/patches/apply') return;
    if (['GET', 'HEAD'].includes(request.method) && ['/', '/health', '/api/health'].includes(path)) return;
    if (request.method === 'POST' && ['/api/slack/interactions', '/api/webhooks/twilio/whatsapp', '/api/webhooks/twilio/voice', '/api/webhooks/twilio/voice/respond', '/api/webhooks/twilio/sms', '/api/webhooks/twilio/status', '/api/webhooks/resend/inbound'].includes(path)) return;
    if (request.method === 'POST' && path === '/api/auth/signin') return;
    if (request.method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(path)) return;
    if ((request.method === 'POST' && ['/api/reason', '/api/reasoning/stream', '/api/v1/realtime/voice-ticket'].includes(path)) || (request.method === 'GET' && path === '/api/auth/verify')) return requireUser(request, reply);
    if (request.method === 'GET' && path === '/api/v1/realtime/voice') return;
    return requireAdmin(request, reply);
  });
}

export const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/auth/signin', async (request: FastifyRequest<{ Body: SigninRequestBody }>, reply: FastifyReply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) return reply.status(400).send({ error: 'Bad Request', message: 'Both email and password are required.' });
    try {
      const user = await fastify.prisma.user.findUnique({ where: { email } });
      if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid email or password.' });
      }
      const jwt = (fastify as FastifyInstance & { jwt?: { sign(payload: object, options?: object): string } }).jwt;
      const token = jwt ? jwt.sign({ id: user.id, email: user.email }) : null;
      return reply.status(200).send({ success: true, message: 'Signed in successfully.', ...(token && { token }) });
    } catch (error: unknown) {
      request.log.error({ err: error }, '[Auth] Database error encountered during signin');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Service temporarily unavailable. Please try again later.' });
    }
  });

  fastify.get('/api/auth/verify', { preHandler: requireUser }, async (request) => {
    if (request.authUser) {
      try {
        await fastify.prisma.jarvisAuditEvent.create({
          data: {
            actorId: request.authUser.id,
            eventType: 'auth.session.verified',
            resourceId: request.authUser.id,
            details: { provider: 'supabase', owner: request.authUser.isOwner, role: request.authUser.role },
          },
        });
      } catch (error) {
        request.log.error({ err: error }, 'Could not persist authentication audit event');
      }
    }
    return { authenticated: true, user: request.authUser };
  });

  for (const path of ['/api/auth/login', '/api/auth/logout']) {
    fastify.post(path, async (_request, reply) => reply.code(410).send({ error: 'Use the application sign-in and sign-out controls.' }));
  }
};
