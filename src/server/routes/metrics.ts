import { requireAdmin } from './auth.js';
import { FastifyPluginAsync } from 'fastify';

export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

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
