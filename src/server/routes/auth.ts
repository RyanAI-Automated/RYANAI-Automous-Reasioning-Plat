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
  sessionId?: string;
}

export function hasAdminAccess(user?: Partial<Pick<AuthenticatedUser, 'role' | 'isOwner'>> | null): boolean {
  return Boolean(user && (user.role === 'admin' || user.isOwner));
}

declare module 'fastify' {
  interface FastifyRequest { authUser: AuthenticatedUser | null; }
  interface FastifyInstance { prisma: PrismaClient; }
}

function getBearerToken(request: FastifyRequest): string | null {
  return /^Bearer ([^\s]+)$/i.exec(request.headers.authorization || '')?.[1] ?? null;
}

function getVerifiedSessionId(token: string): string | null {
  try {
    const encoded = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { session_id?: unknown };
    if (typeof payload.session_id === 'string' && payload.session_id.length > 0 && payload.session_id.length <= 128) return payload.session_id;
  } catch {
    // Supabase has verified the token; malformed session claims are rejected below.
  }
  return null;
}

async function verifySupabaseIdentity(token: string) {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return { response: { status: 503, error: 'Authentication is not configured.' } as const };
  const client = createContextClient({
    env: { url, publishableKeys: { default: key } },
    auth: { token },
    supabaseOptions: { global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) {
    const status = error && (!error.status || error.status >= 500) ? 503 : 401;
    return { response: { status, error: status === 503 ? 'Authentication is temporarily unavailable.' : 'Invalid or expired session. Please sign in again.' } as const };
  }
  return { user: data.user };
}

async function registerVerifiedSession(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
  user: { id: string; email?: string },
): Promise<string | null> {
  const sessionId = getVerifiedSessionId(token);
  if (!sessionId) {
    reply.code(401).send({ error: 'The verified identity token has no Supabase session identifier.' });
    return null;
  }
  if (!request.server.hasDecorator('prisma')) {
    reply.code(503).send({ error: 'Session security is not configured.' });
    return null;
  }
  const registry = request.server.prisma.apiAuthSession;
  const session = await registry.upsert({
    where: { sessionId },
    create: { sessionId, userId: user.id, email: user.email ?? null },
    update: {},
  });
  if (session.revokedAt) {
    reply.code(401).send({ error: 'This RyanAI API session has been revoked. Sign in again.' });
    return null;
  }
  await registry.updateMany({
    where: { sessionId, revokedAt: null, lastSeenAt: { lt: new Date(Date.now() - 60_000) } },
    data: { lastSeenAt: new Date(), email: user.email ?? null },
  });
  return sessionId;
}

function toAuthenticatedUser(user: {
  id: string;
  email?: string;
  app_metadata?: { role?: string };
  user_metadata?: { full_name?: unknown };
}, sessionId: string): AuthenticatedUser {
  const ownerEmail = process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase();
  return {
    id: user.id,
    email: user.email,
    role: user.app_metadata?.role === 'admin' ? 'admin' : 'user',
    displayName: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : undefined,
    isOwner: Boolean(user.email && ownerEmail && user.email.toLowerCase() === ownerEmail),
    sessionId,
  };
}

/** Verify the bearer token with Supabase; never trust browser-editable role metadata. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser) return;
  const token = getBearerToken(request);
  if (!token) return reply.code(401).send({ error: 'Sign in to continue.' });

  try {
    const identity = await verifySupabaseIdentity(token);
    if (identity.response) return reply.code(identity.response.status).send({ error: identity.response.error });
    const sessionId = await registerVerifiedSession(request, reply, token, identity.user);
    if (!sessionId) return;
    request.authUser = toAuthenticatedUser(identity.user, sessionId);
  } catch {
    return reply.code(503).send({ error: 'Authentication is temporarily unavailable.' });
  }
}

/** Owner identity is resolved only from the server-side configured owner email. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (!hasAdminAccess(request.authUser)) return reply.code(403).send({ error: 'Administrator access is required.' });
}

function isCommsRequest(path: string): boolean {
  return path.startsWith('/api/comms/');
}

function isUnauthenticatedEndpoint(method: string, path: string): boolean {
  if (method === 'POST' && path === '/api/internal/openai/chat') return true;
  if (method === 'POST' && path === '/api/jarvis/patches/apply') return true;
  if (['GET', 'HEAD'].includes(method) && ['/', '/health', '/api/health'].includes(path)) return true;
  if (method === 'POST' && [
    '/api/slack/interactions', '/api/webhooks/twilio/whatsapp', '/api/webhooks/twilio/voice',
    '/api/webhooks/twilio/voice/respond', '/api/webhooks/twilio/sms', '/api/webhooks/twilio/status',
    '/api/webhooks/resend/inbound',
  ].includes(path)) return true;
  return method === 'POST' && ['/api/auth/signin', '/api/auth/login', '/api/auth/logout'].includes(path);
}

function requiresUserAuthentication(method: string, path: string): boolean {
  return (method === 'POST' && ['/api/reason', '/api/reasoning/stream', '/api/v1/realtime/voice-ticket'].includes(path))
    || (method === 'GET' && path === '/api/auth/verify');
}

export function installAuthentication(fastify: FastifyInstance) {
  fastify.decorateRequest('authUser', null);
  fastify.addHook('preValidation', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (request.method === 'OPTIONS' || isUnauthenticatedEndpoint(request.method, path)) return;
    if (isCommsRequest(path)) {
      await requireUser(request, reply);
      if (reply.sent) return;
      if (!hasAdminAccess(request.authUser)) return reply.code(403).send({ error: 'Owner or administrator access is required.' });
      return;
    }
    if (requiresUserAuthentication(request.method, path)) return requireUser(request, reply);
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
    if (request.authUser && fastify.hasDecorator('prisma')) {
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
