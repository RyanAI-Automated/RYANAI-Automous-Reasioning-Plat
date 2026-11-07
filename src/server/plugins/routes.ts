import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../routes/auth.js';
import { pluginRegistry } from './pluginCatalog.js';

/**
 * Read-only metadata endpoint for the Settings integrations centre.
 * It intentionally exposes no credentials, connection state or execution API.
 */
export const pluginRegistryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/plugins/registry', { preHandler: requireUser }, async () => ({
    providers: pluginRegistry.list(),
  }));
};
