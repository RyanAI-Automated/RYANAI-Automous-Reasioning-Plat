import Fastify from 'fastify';
import { registerPatchRoutes } from './patchRoutes.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: 'info',
    },
  });

  // Register self-patching autonomous engine routes
  await fastify.register(registerPatchRoutes);

  // Gateway health telemetry check
  fastify.get('/health', async () => {
    return {
      status: 'healthy',
      platform: 'RyanAI Sovereign Reasoning Gateway',
      timestamp: new Date().toISOString(),
    };
  });

  return fastify;
}
