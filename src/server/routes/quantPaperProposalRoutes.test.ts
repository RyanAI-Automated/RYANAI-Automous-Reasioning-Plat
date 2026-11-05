import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  signal: {
    id: 'signal-a',
    market_data_import_id: 'market-import-a',
    symbol: 'SPY',
    action: 'buy',
    reference_price: '100',
    last_bar_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
    is_stale: false,
    feed: 'iex',
  },
  proposal: {
    id: 'proposal-a',
    signal_id: 'signal-a',
    market_data_import_id: 'market-import-a',
    symbol: 'SPY',
    side: 'buy' as 'buy' | 'sell',
    quantity: '10',
    reference_price: '100',
    notional: '1000',
    client_order_id: 'qp-order-client-123456',
    status: 'confirming',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    order_id: null,
    reason: null,
    created_at: new Date(),
    decided_at: new Date(),
  },
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $queryRawUnsafe: mocks.query,
    $executeRawUnsafe: mocks.execute,
  },
}));

import { quantPaperProposalRoutes } from './quantPaperProposalRoutes.js';

async function createApp() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = { id: 'proposal-user-a', role: 'user', isOwner: false };
  });
  app.post('/api/quant/paper/orders', async (_request, reply) => {
    return reply.code(201).send({
      orderId: 'paper-order-a',
      status: 'filled',
      duplicate: false,
      mode: 'paper_simulation_only',
      brokerConnected: false,
    });
  });
  await app.register(quantPaperProposalRoutes);
  return app;
}

describe('strategy-driven paper order proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signal = {
      id: 'signal-a',
      market_data_import_id: 'market-import-a',
      symbol: 'SPY',
      action: 'buy',
      reference_price: '100',
      last_bar_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
      is_stale: false,
      feed: 'iex',
    };
    mocks.proposal = {
      id: 'proposal-a',
      signal_id: 'signal-a',
      market_data_import_id: 'market-import-a',
      symbol: 'SPY',
      side: 'buy',
      quantity: '10',
      reference_price: '100',
      notional: '1000',
      client_order_id: 'qp-order-client-123456',
      status: 'confirming',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      order_id: null,
      reason: null,
      created_at: new Date(),
      decided_at: new Date(),
    };
    mocks.execute.mockResolvedValue(1);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM quant_strategy_signals s')) return [mocks.signal];
      if (sql.includes('FROM quant_paper_risk_policies')) {
        return [{
          max_order_notional: '2000',
          max_position_notional: '5000',
          max_gross_exposure: '10000',
          trading_enabled: true,
          emergency_stop: false,
        }];
      }
      if (sql.includes('SELECT cash_balance::text')) return [{ cash_balance: '100000' }];
      if (sql.includes('FROM quant_paper_positions')) return [];
      if (sql.includes('SUM(quantity * last_price)')) return [{ gross_exposure: '0' }];
      if (sql.includes('INSERT INTO quant_paper_order_proposals')) return [{ id: 'proposal-a' }];
      if (sql.includes('RETURNING id, signal_id, market_data_import_id')) return [mocks.proposal];
      if (sql.includes('SELECT last_bar_at, is_stale')) {
        return [{ last_bar_at: new Date(Date.now() - 24 * 60 * 60 * 1000), is_stale: false }];
      }
      if (sql.includes('SELECT status, order_id')) return [{ status: 'pending', order_id: null }];
      if (sql.includes('FROM quant_paper_order_proposals p')) return [];
      return [];
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('creates a pending proposal from a fresh user-owned buy signal without placing an order', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/proposals',
      payload: { signalId: 'signal-a', notional: 1000 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      proposal: {
        id: 'proposal-a',
        symbol: 'SPY',
        side: 'buy',
        quantity: 10,
        referencePrice: 100,
        notional: 1000,
        status: 'pending',
      },
      orderPlaced: false,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE s.id = $1 AND s.user_id = $2'),
      'signal-a',
      'proposal-user-a',
    );
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO quant_paper_order_proposals'))).toBe(true);
    await app.close();
  });

  it('refuses hold signals because they do not propose a buy or sell', async () => {
    mocks.signal = { ...mocks.signal, action: 'hold' };
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/proposals',
      payload: { signalId: 'signal-a', notional: 1000 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain('Hold signals are not actionable');
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO quant_paper_order_proposals'))).toBe(false);
    await app.close();
  });

  it('refuses stale or invalid market-data imports', async () => {
    mocks.signal = { ...mocks.signal, is_stale: true };
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/proposals',
      payload: { signalId: 'signal-a', notional: 1000 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('source market-data import is stale');
    await app.close();
  });

  it('requires an explicit confirmation and routes the fill through the paper-order endpoint', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/proposals/proposal-a/confirm',
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      proposalId: 'proposal-a',
      status: 'confirmed',
      order: { orderId: 'paper-order-a', status: 'filled' },
      brokerConnected: false,
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'confirmed', order_id = $3"),
      'proposal-a',
      'proposal-user-a',
      'paper-order-a',
    );
    await app.close();
  });

  it('rejects a signal that belongs to another authenticated user', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM quant_strategy_signals s')) return [];
      return [];
    });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/proposals',
      payload: { signalId: 'another-users-signal', notional: 1000 },
    });
    expect(response.statusCode).toBe(404);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO quant_paper_order_proposals'))).toBe(false);
    await app.close();
  });

  it('blocks proposal creation while the paper account is paused or emergency-stopped', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM quant_strategy_signals s')) return [mocks.signal];
      if (sql.includes('FROM quant_paper_risk_policies')) {
        return [{
          max_order_notional: '2000',
          max_position_notional: '5000',
          max_gross_exposure: '10000',
          trading_enabled: false,
          emergency_stop: true,
        }];
      }
      return [];
    });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/proposals',
      payload: { signalId: 'signal-a', notional: 1000 },
    });
    expect(response.statusCode).toBe(423);
    expect(response.json().error).toContain('emergency stop is active');
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO quant_paper_order_proposals'))).toBe(false);
    await app.close();
  });

  it('lists only the signed-in account proposals and their source metadata', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM quant_paper_order_proposals p')) {
        return [{
          ...mocks.proposal,
          status: 'pending',
          strategy: 'sma_crossover',
          signal_action: 'buy',
          source_bar_date: '2026-11-04',
        }];
      }
      return [];
    });
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/quant/paper/proposals',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      proposals: [{
        id: 'proposal-a',
        symbol: 'SPY',
        side: 'buy',
        strategy: 'sma_crossover',
        status: 'pending',
        sourceBarDate: '2026-11-04',
      }],
      executionEnabled: false,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE p.user_id = $1'),
      'proposal-user-a',
    );
    await app.close();
  });

  it('rejects confirmation when the saved source market data has become stale', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('RETURNING id, signal_id, market_data_import_id')) return [mocks.proposal];
      if (sql.includes('SELECT last_bar_at, is_stale')) {
        return [{ last_bar_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), is_stale: false }];
      }
      return [];
    });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/proposals/proposal-a/confirm',
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('source data is stale');
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'rejected'"),
      'proposal-a',
      'proposal-user-a',
    );
    await app.close();
  });

  it('rejects only a pending proposal owned by the authenticated user', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/proposals/proposal-a/reject',
      payload: { reason: 'reviewed_not_suitable' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ proposalId: 'proposal-a', status: 'rejected' });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'rejected'"),
      'proposal-a',
      'proposal-user-a',
      'reviewed_not_suitable',
    );
    await app.close();
  });
});
