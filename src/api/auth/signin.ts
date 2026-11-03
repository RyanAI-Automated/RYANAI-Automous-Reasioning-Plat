import type { FastifyInstance } from 'fastify';

/**
 * Compatibility tombstone for the retired local-password endpoint.
 * The supported UI signs in directly with Supabase Auth; this plugin must
 * never inspect local password hashes or issue application JWTs.
 */
export default async function retiredLocalSigninRoute(fastify: FastifyInstance) {
  fastify.post('/signin', async (_request, reply) =>
    reply.code(410).send({
      error: 'Local password sign-in is retired. Use Supabase Auth.',
    }),
  );
}
