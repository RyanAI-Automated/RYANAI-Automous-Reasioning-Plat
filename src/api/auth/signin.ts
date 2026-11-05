import type { FastifyPluginAsync } from 'fastify';

const RETIRED_LOCAL_SIGNIN_MESSAGE =
  'Local password sign-in has been retired. Use Supabase Auth through the RyanAI sign-in page.';

/**
 * Retired compatibility path. Supabase Auth is the only supported browser
 * sign-in authority; this endpoint must never create a second local session.
 */
const authSigninRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/signin', async (_request, reply) =>
    reply.code(410).send({
      success: false,
      error: 'Gone',
      message: RETIRED_LOCAL_SIGNIN_MESSAGE,
    }),
  );
};

export default authSigninRoute;
