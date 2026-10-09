import { FastifyPluginAsync } from 'fastify';

/** Registers the admin metrics endpoint, protected by JWT verification, reporting process-level stats. */
export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply JWT verification middleware to restrict access to authenticated admins
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401);
      return reply.send({ error: 'Unauthorized' });
    }
  });

  fastify.get('/api/admin/metrics', async () => {
    // This endpoint reports process metrics; dependency health is available at /health.
    const dbStatus = 'unknown';

    const memory = process.memoryUsage();

    return {
      status: 'operational',
      uptime: process.uptime(), // Uptime in seconds
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        driver: 'PostgreSQL (@langchain/langgraph-checkpoint-postgres)',
      },
      system: {
        nodeVersion: process.version,
        rssMemoryMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
      },
    };
  });
};