import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { createContextClient } from '@supabase/server/core';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthenticatedUser | null;
  }
}

/**
 * Verify with Supabase Auth; never trust a decoded token or browser metadata.
 * Attach a non-anonymous authUser after bearer-token verification.
 * Reuses an existing authUser. Roles come from app_metadata. Missing or invalid
 * sessions receive 401. Missing configuration, provider errors with no status or
 * status >= 500, and caught exceptions receive 503.
 * Provider exceptions are converted to responses, with a five-second fetch timeout.
 */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (request.authUser) return;
  const token = /^Bearer ([^\s]+)$/i.exec(
    request.headers.authorization || '',
  )?.[1];
  if (!token) {
    return reply.code(401).send({ error: 'Sign in to continue.' });
  }

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    return reply.code(503).send({ error: 'Authentication is not configured.' });
  }

  try {
    const client = createContextClient({
      env: { url, publishableKeys: { default: key } },
      auth: { token },
      supabaseOptions: {
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
        },
      },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user || data.user.is_anonymous) {
      const status =
        error && (!error.status || error.status >= 500) ? 503 : 401;
      return reply.code(status).send({
        error:
          status === 503
            ? 'Authentication is temporarily unavailable.'
            : 'Invalid or expired session. Please sign in again.',
      });
    }
    request.authUser = {
      id: data.user.id,
      email: data.user.email,
      // app_metadata can only be assigned by a trusted server/admin.
      role: data.user.app_metadata?.role === 'admin' ? 'admin' : 'user',
    };
  } catch {
    return reply
      .code(503)
      .send({ error: 'Authentication is temporarily unavailable.' });
  }
}

/**
 * Require a verified user, responding with 403 unless authUser has the admin role.
 * Preserves authentication error responses from requireUser.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (request.authUser?.role !== 'admin') {
    return reply.code(403).send({ error: 'Administrator access is required.' });
  }
}

/**
 * Install authentication before routes, including WebSocket upgrades.
 * Allow OPTIONS, public health/index routes, retired login/logout routes, and webhooks
 * with their own signature checks. Reasoning and verification routes require a user;
 * all remaining routes require an admin.
 */
export function installAuthentication(fastify: FastifyInstance) {
  fastify.decorateRequest('authUser', null);
  // Run after onRequest rate limits, before route handlers or websocket upgrades.
  fastify.addHook('preValidation', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (request.method === 'OPTIONS') return;
    if (
      ['GET', 'HEAD'].includes(request.method) &&
      ['/', '/health', '/api/health'].includes(path)
    )
      return;
    // These routes perform their own provider-signature verification.
    if (
      request.method === 'POST' &&
      ['/api/slack/interactions', '/api/webhooks/twilio/whatsapp'].includes(
        path,
      )
    )
      return;
    if (
      request.method === 'POST' &&
      ['/api/auth/login', '/api/auth/logout'].includes(path)
    )
      return;
    if (
      (request.method === 'POST' &&
        ['/api/reason', '/api/reasoning/stream'].includes(path)) ||
      (request.method === 'GET' && path === '/api/auth/verify')
    ) {
      return requireUser(request, reply);
    }
    // Approvals, communications, metrics and shared websocket channels are admin-only.
    return requireAdmin(request, reply);
  });
}

/** Register session verification and respond with 410 for retired login/logout endpoints. */
export const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/auth/verify',
    { preHandler: requireUser },
    async (request) => ({
      authenticated: true,
      user: request.authUser,
    }),
  );

  // Retire the separate shared-password/cookie identity. Accounts and sign-out
  // now use Supabase Auth directly, including its refresh-token lifecycle.
  for (const path of ['/api/auth/login', '/api/auth/logout']) {
    fastify.post(path, async (_request, reply) =>
      reply.code(410).send({
        error:
          'Use the application sign-in and sign-out controls (Supabase Auth).',
      }),
    );
  }
};
