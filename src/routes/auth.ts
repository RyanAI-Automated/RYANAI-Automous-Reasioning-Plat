import type { FastifyInstance } from 'fastify';

/**
 * Legacy entrypoint compatibility only. Local Prisma/bcrypt/JWT authentication
 * is retired; these historical routes must never create or verify sessions.
 */
export async function registerAuthRoutes(fastify: FastifyInstance) {
  for (const route of [
    { method: 'POST' as const, url: '/api/auth/signup' },
    { method: 'POST' as const, url: '/api/auth/signin' },
    { method: 'GET' as const, url: '/api/auth/me' },
  ]) {
    fastify.route({
      ...route,
      handler: async (_request, reply) =>
        reply.code(410).send({
          error: 'Legacy local authentication is retired. Use Supabase Auth.',
        }),
    });
  }
}
