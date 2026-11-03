import { requireAdmin } from './auth.js';
import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { resolveBrainProviderConfig } from '../../agent/providerConfig.js';

function safeEndpointHost(endpoint: string): string {
  try { return new URL(endpoint).host; } catch { return 'invalid-endpoint'; }
}

/**
 * Admin-only operational metrics. Model credentials are represented only as
 * configured booleans; secrets and full endpoint URLs are never returned.
 */
export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/api/admin/metrics', async () => {
    const memory = process.memoryUsage();
    return {
      status: 'operational',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: { status: 'unknown', driver: 'PostgreSQL (@langchain/langgraph-checkpoint-postgres)' },
      system: {
        nodeVersion: process.version,
        rssMemoryMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
      },
    };
  });

  fastify.get('/api/admin/models', async () => {
    const brains = (['primary', 'secondary', 'logic'] as const).map((brain) => {
      const config = resolveBrainProviderConfig(brain);
      return {
        brain,
        model: config.model,
        endpointHost: safeEndpointHost(config.endpoint),
        credentialConfigured: config.credential,
        configurationSource: 'server-environment',
        mutableAtRuntime: false,
      };
    });
    return {
      brains,
      configurationPolicy: 'Read-only. Change provider configuration through reviewed server environment updates and restart.',
    };
  });

  fastify.get('/api/admin/usage', async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalRuns, recentRuns, grouped, handoffs] = await Promise.all([
      prisma.agentRun.count(),
      prisma.agentRun.count({ where: { createdAt: { gte: since } } }),
      prisma.agentRun.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.agentHandoff.groupBy({ by: ['toAgent', 'status'], _count: { _all: true } }),
    ]);
    return {
      windowDays: 30,
      totalRuns,
      runsLast30Days: recentRuns,
      runsByStatus: grouped.map((entry) => ({ status: entry.status, count: entry._count._all })),
      handoffsByAgent: handoffs.map((entry) => ({ agent: entry.toAgent, status: entry.status, count: entry._count._all })),
      usageAccounting: {
        executionRecords: 'available',
        providerRequests: 'not-instrumented',
        inputTokens: 'not-instrumented',
        outputTokens: 'not-instrumented',
        estimatedCost: 'not-instrumented',
        note: 'Run counts are derived from persisted AgentRun records. Token and billing values are intentionally not estimated.',
      },
    };
  });
};
