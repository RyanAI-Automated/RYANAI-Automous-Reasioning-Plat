import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { quantBrokerCertificationRoutes } from './quantBrokerCertificationRoutes.js';

describe('Quant broker certification status route', () => {
  it('reports the disabled adapter without enabling execution', async () => {
    const app = Fastify();
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: 'cert-user', role: 'user', isOwner: false };
    });
    await app.register(quantBrokerCertificationRoutes);
    const response = await app.inject({
      method: 'GET',
      url: '/api/quant/broker/certification',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      adapterId: 'disabled',
      status: 'disabled',
      certified: false,
      adapterLiveTradingEnabled: false,
      executionAllowed: false,
      placeOrderInvoked: false,
      providerAdaptersRegistered: 0,
    });
    await app.close();
  });
});
