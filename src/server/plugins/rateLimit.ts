import { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';

export const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyRateLimit, {
    // Default global limit: 100 requests per 1 minute per IP
    global: true,
    max: 100,
    timeWindow: '1 minute',
    redis: fastify.redis, // Uses Redis for distributed rate tracking across multiple containers
    errorResponseBuilder: (request, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${context.after}.`,
      };
    },
  });
};