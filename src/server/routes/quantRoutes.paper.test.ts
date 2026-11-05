import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  riskPolicy: null as null | { max_order_notional: string; max_position_notional: string; max_gross_exposure: string; trading_enabled: boolean },
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    quantExperiment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    $executeRawUnsafe: mocks.execute,
    $queryRawUnsafe: mocks.query,
    $transaction: mocks.transaction,
  },
}));

import { quantRoutes } from './quantRoutes.js';

function createApp() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = { id: 'paper-user-a', role: 'user', isOwner: false };
  });
  return app.register(quantRoutes);
}

describe('Quant paper trading routes', () => {
  const tx = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.riskPolicy = null;
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    tx.$executeRawUnsafe.mockResolvedValue(1);
    tx.$queryRawUnsafe.mockImplementation(async (query: string) => {
      if (query.includes('SELECT cash_balance::text')) return [{ cash_balance: '100000' }];
      if (query.includes('FROM quant_paper_risk_policies')) return mocks.riskPolicy ? [mocks.riskPolicy] : [];
      if (query.includes('SELECT id, status FROM quant_paper_orders')) return [];
      if (query.includes('SELECT quantity::text')) return [];
      if (query.includes('SUM(quantity * last_price)')) return [{ gross_exposure: '0' }];
      if (query.includes('RETURNING id')) return [{ id: 'paper-order-1' }];
      return [];
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('fills a user-scoped buy order only in the virtual ledger', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/orders',
      payload: {
        symbol: 'AAPL', side: 'buy', quantity: 2,
        reference_price: 100, client_order_id: 'paper-order-client-001',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      mode: 'paper_simulation_only', brokerConnected: false,
      status: 'filled', symbol: 'AAPL', side: 'buy', quantity: 2, fillPrice: 100,
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE quant_paper_accounts SET cash_balance = cash_balance -'),
      'paper-user-a', 200.1,
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO quant_paper_trades'),
      'paper-order-1', 'paper-user-a', 'AAPL', 'buy', 2, 100, 0.1, null,
    );
    await app.close();
  });

  it('rejects a sell when the user has no matching paper position', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/orders',
      payload: {
        symbol: 'AAPL', side: 'sell', quantity: 1,
        reference_price: 100, client_order_id: 'paper-order-client-002',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('cannot sell more units');
    expect(tx.$executeRawUnsafe.mock.calls.some(([query]) => String(query).includes('INSERT INTO quant_paper_orders'))).toBe(false);
    await app.close();
  });

  it('rejects an order above the notional risk cap before opening a transaction', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/orders',
      payload: {
        symbol: 'AAPL', side: 'buy', quantity: 101,
        reference_price: 100, client_order_id: 'paper-order-client-003',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    await app.close();
  });  
  it('rejects an order above the user-configured per-order limit', async () => {
    mocks.riskPolicy = {
      max_order_notional: '500',
      max_position_notional: '2000',
      max_gross_exposure: '5000',
      trading_enabled: true,
    };
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/paper/orders',
      payload: {
        symbol: 'AAPL', side: 'buy', quantity: 6,
        reference_price: 100, client_order_id: 'paper-order-client-004',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('per-order risk limit');
    expect(tx.$executeRawUnsafe.mock.calls.some(([query]) => String(query).includes('INSERT INTO quant_paper_orders'))).toBe(false);
    await app.close();
  });

  it('rejects a buy that would exceed the single-position exposure limit', async () => {
    mocks.riskPolicy = {
      max_order_notional: '10000',
      max_position_notional: '500',
      max_gross_exposure: '5000',
      trading_enabled: true,
    };
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/paper/orders',
      payload: {
        symbol: 'AAPL', side: 'buy', quantity: 6,
        reference_price: 100, client_order_id: 'paper-order-client-005',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('single-position exposure');
    await app.close();
  });

  it('rejects all new orders while the user has paused paper trading', async () => {
    mocks.riskPolicy = {
      max_order_notional: '10000',
      max_position_notional: '25000',
      max_gross_exposure: '75000',
      trading_enabled: false,
    };
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/paper/orders',
      payload: {
        symbol: 'AAPL', side: 'buy', quantity: 1,
        reference_price: 100, client_order_id: 'paper-order-client-006',
      },
    });
    expect(response.statusCode).toBe(423);
    expect(response.json().error).toContain('paused');
    await app.close();
  });

});
