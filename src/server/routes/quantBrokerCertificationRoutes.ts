import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';
import { DisabledBrokerAdapter } from '../quant/brokerAdapter.js';
import { certifyBrokerAdapter } from '../quant/brokerAdapterCertification.js';

export const quantBrokerCertificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/quant/broker/certification', {
    preHandler: requireUser,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async () => {
    const report = await certifyBrokerAdapter(new DisabledBrokerAdapter());
    return {
      ...report,
      providerAdaptersRegistered: 0,
      note: 'No provider adapter or credential scope is configured. Sandbox certification requires a separate approved read-only provider integration.',
    };
  });
};
