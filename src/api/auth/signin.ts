import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';

interface SigninRequestBody {
  email: string;
  password: string;
}

// Ensure TypeScript recognizes Fastify instance decorations for Prisma and JWT
declare module 'fastify' {
  interface FastifyInstance {
    prisma: any; // Replace with your generated PrismaClient type if available
  }
}

export default async function authSigninRoute(fastify: FastifyInstance) {
  fastify.post(
    '/signin',
    {
      // Route-level rate limiting (Requires `@fastify/rate-limit` registered on your Fastify instance)
      config: {
        rateLimit: {
          max: 5,                  // Maximum 5 sign-in attempts
          timeWindow: '1 minute',    // Per 1-minute window
          errorResponseBuilder: (_request, context) => ({
            statusCode: 429,
            error: 'Too Many Requests',
            message: `Too many sign-in attempts from this IP. Please try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
          }),
        },
      },
    },
    async (request: FastifyRequest<{ Body: SigninRequestBody }>, reply: FastifyReply) => {
      const { email, password } = request.body ?? {};

      // 1. Basic Payload Validation
      if (!email || !password) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Both email and password are required.',
        });
      }

      try {
        // 2. Database Lookup via Prisma with Connection/Error Resilience
        const user = await fastify.prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.password) {
          // Generic message to prevent user enumeration attacks
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid email or password.',
          });
        }

        // 3. Password Verification
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid email or password.',
          });
        }

        // 4. Session / JWT Token Generation (Optional, using fastify-jwt if configured)
        const jwt = (fastify as FastifyInstance & { jwt?: { sign(payload: object, options?: object): string } }).jwt;
        const token = jwt ? jwt.sign({ id: user.id, email: user.email }) : null;

        return reply.status(200).send({
          success: true,
          message: 'Signed in successfully.',
          ...(token && { token }),
        });

      } catch (error: any) {
        // Catch connection drops, pool timeouts, or unhandled database exceptions
        request.log.error(error, '[Auth] Database error encountered during signin');

        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Service temporarily unavailable. Please try again later.',
        });
      }
    }
  );
}