import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { createContextClient } from '@supabase/server/core';
import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
import { isSupportedRyanLanguage, DEFAULT_RYANAI_LANGUAGE } from '../../shared/languages.js';

// --- Interfaces & Types ---

interface SigninRequestBody {
  email: string;
  password: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: 'user' | 'admin';
  displayName?: string;
  isOwner: boolean;
  preferredTitle?: string;
  preferredLanguage: string;
}

// Augment Fastify types to include custom request properties and Prisma instance
declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthenticatedUser | null;
  }
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

// --- Middleware & Guards (Supabase Auth) ---

/**
 * Verify with Supabase Auth; never trust a decoded token or browser metadata.
 * Attach a non-anonymous authUser after bearer-token verification.
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

    const isOwner = Boolean(data.user.email && process.env.RYANAI_OWNER_EMAIL?.trim() && data.user.email.toLowerCase() === process.env.RYANAI_OWNER_EMAIL.trim().toLowerCase());
    const profileName = typeof data.user.user_metadata?.full_name === 'string' ? data.user.user_metadata.full_name : undefined;
    request.authUser = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.app_metadata?.role === 'admin' ? 'admin' : 'user',
      displayName: isOwner ? (process.env.RYANAI_OWNER_NAME?.trim() || profileName) : profileName,
      isOwner,
      preferredTitle: typeof data.user.user_metadata?.preferred_title === 'string' ? data.user.user_metadata.preferred_title : undefined,
      preferredLanguage: typeof data.user.user_metadata?.preferred_language === 'string' && isSupportedRyanLanguage(data.user.user_metadata.preferred_language) ? data.user.user_metadata.preferred_language : DEFAULT_RYANAI_LANGUAGE,
    };
  } catch {
    return reply
      .code(503)
      .send({ error: 'Authentication is temporarily unavailable.' });
  }
}

/**
 * Require a verified user, responding with 403 unless authUser has the admin role.
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

// --- Global Hook Installer ---

/**
 * Install authentication before routes, including WebSocket upgrades.
 */
export function installAuthentication(fastify: FastifyInstance) {
  fastify.decorateRequest('authUser', null);

  fastify.addHook('preValidation', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (request.method === 'OPTIONS') return;
    // This machine-to-machine route verifies JARVIS_INGRESS_TOKEN in its own preHandler.
    if (request.method === 'POST' && path === '/api/jarvis/patches/apply') return;
    
    if (
      ['GET', 'HEAD'].includes(request.method) &&
      ['/', '/health', '/api/health'].includes(path)
    ) {
      return;
    }

    // Webhooks with their own signature verification
    if (
      request.method === 'POST' &&
      ['/api/slack/interactions', '/api/webhooks/twilio/whatsapp', '/api/webhooks/twilio/voice', '/api/webhooks/twilio/voice/respond', '/api/webhooks/twilio/sms', '/api/webhooks/twilio/status', '/api/webhooks/resend/inbound'].includes(path)
    ) {
      return;
    }

    // Public auth signin route
    if (request.method === 'POST' && path === '/api/auth/signin') {
      return;
    }

    // Retired legacy login/logout routes
    if (
      request.method === 'POST' &&
      ['/api/auth/login', '/api/auth/logout'].includes(path)
    ) {
      return;
    }

    if (
      (request.method === 'POST' &&
        ['/api/reason', '/api/reasoning/stream'].includes(path)) ||
      (request.method === 'GET' && path === '/api/auth/verify')
    ) {
      return requireUser(request, reply);
    }

    return requireAdmin(request, reply);
  });
}

// --- Fastify Plugin Registration ---

export const authPlugin: FastifyPluginAsync = async (fastify) => {
  // 1. Prisma-backed local sign-in route (/api/auth/signin)
  fastify.post('/api/auth/signin', async (request: FastifyRequest<{ Body: SigninRequestBody }>, reply: FastifyReply) => {
    const { email, password } = request.body ?? {};

    if (!email || !password) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Both email and password are required.',
      });
    }

    try {
      const user = await fastify.prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.passwordHash) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid email or password.',
        });
      }

      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

      if (!isPasswordValid) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid email or password.',
        });
      }

      const jwt = (fastify as FastifyInstance & { jwt?: { sign(payload: object, options?: object): string } }).jwt;
      const token = jwt ? jwt.sign({ id: user.id, email: user.email }) : null;

      return reply.status(200).send({
        success: true,
        message: 'Signed in successfully.',
        ...(token && { token }),
      });

    } catch (error: unknown) {
      request.log.error({ err: error }, '[Auth] Database error encountered during signin');

      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Service temporarily unavailable. Please try again later.',
      });
    }
  });

  // 2. Session verification route
  fastify.get(
    '/api/auth/verify',
    { preHandler: requireUser },
    async (request) => ({
      authenticated: true,
      user: request.authUser,
    }),
  );

  // 3. Retire legacy shared-password/cookie endpoints
  for (const path of ['/api/auth/login', '/api/auth/logout']) {
    fastify.post(path, async (_request, reply) =>
      reply.code(410).send({
        error: 'Use the application sign-in and sign-out controls.',
      }),
    );
  }
};