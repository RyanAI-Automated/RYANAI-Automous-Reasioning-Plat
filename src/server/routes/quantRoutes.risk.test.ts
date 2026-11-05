import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    quantExperiment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    $executeRawUnsafe: mocks.execute,
    $queryRawUnsafe: mocks.query,
    $transaction: vi.fn(),
  },
}));

import { quantRoutes } from './quantRoutes.js';

async function appForUser() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = { id: 'risk-user-a', role: 'user', isOwner: false };
  });
  await app.register(quantRoutes);
  return app;
}

describe('Quant paper risk policy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(1);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns a user-scoped policy with hard caps and no short selling', async () => {
    mocks.query.mockResolvedValue([{
      max_order_notional: '5000',
      max_position_notional: '12000',
      max_gross_exposure: '30000',
      trading_enabled: true,
    }]);
    const app = await appForUser();
    const response = await app.inject({ method: 'GET', url: '/api/quant/paper/risk' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tradingEnabled: true, maxOrderNotional: 5000,
      maxPositionNotional: 12000, maxGrossExposure: 30000,
      hardCaps: { maxOrderNotional: 10000, maxPositionNotional: 50000, maxGrossExposure: 100000 },
      shortSelling: false, mode: 'paper_simulation_only',
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), 'risk-user-a');
    await app.close();
  });

  it('persists a valid user risk policy without exceeding platform caps', async () => {
    const app = await appForUser();
    const response = await app.inject({
      method: 'PUT', url: '/api/quant/paper/risk',
      payload: {
        tradingEnabled: false,
        maxOrderNotional: 2000,
        maxPositionNotional: 10000,
        maxGrossExposure: 40000,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ tradingEnabled: false, maxOrderNotional: 2000 });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (user_id) DO UPDATE'),
      'risk-user-a', 2000, 10000, 40000, false,
    );
    await app.close();
  });

  it('rejects inconsistent order, position and gross exposure limits', async () => {
    const app = await appForUser();
    const response = await app.inject({
      method: 'PUT', url: '/api/quant/paper/risk',
      payload: {
        tradingEnabled: true,
        maxOrderNotional: 9000,
        maxPositionNotional: 5000,
        maxGrossExposure: 40000,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
    await app.close();
  });
});
