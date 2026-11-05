import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({ fetch: vi.fn() }));
const db = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    quantExperiment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    $executeRawUnsafe: db.execute,
    $queryRawUnsafe: db.query,
    $transaction: vi.fn(),
  },
}));

vi.mock('../quant/alpacaMarketData.js', () => ({
  fetchAlpacaDailyBars: provider.fetch,
  MarketDataError: class MarketDataError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly statusCode: number,
      readonly lastBarAt?: string,
    ) { super(message); }
  },
}));

import { quantRoutes } from './quantRoutes.js';
import { MarketDataError } from '../quant/alpacaMarketData.js';
import type { QuantBar } from '../quant/alpacaMarketData.js';

const userId = 'market-data-user-a';

function makeBars(count = 32): QuantBar[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.now() - (count - index) * 24 * 60 * 60 * 1000);
    return {
      date: date.toISOString().slice(0, 10),
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 1000,
    };
  });
}

function importRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'import-owned-a',
    symbol: 'SPY',
    provider: 'alpaca',
    feed: 'iex',
    timeframe: '1Day',
    adjustment: 'all',
    last_bar_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
    fetched_at: new Date(),
    is_stale: false,
    bars: makeBars(),
    provenance: { provider: 'alpaca', feed: 'iex' },
    ...overrides,
  };
}

async function appForUser() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = { id: userId, role: 'user', isOwner: false };
  });
  await app.register(quantRoutes);
  return app;
}

describe('Quant market-data and signal routes', () => {
  const previousApiKey = process.env.ALPACA_API_KEY;
  const previousApiSecret = process.env.ALPACA_API_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALPACA_API_KEY = 'test-paper-key';
    process.env.ALPACA_API_SECRET = 'test-paper-secret';
    provider.fetch.mockResolvedValue({
      symbol: 'SPY',
      provider: 'alpaca',
      feed: 'iex',
      timeframe: '1Day',
      adjustment: 'all',
      fetchedAt: new Date().toISOString(),
      firstBarAt: new Date(Date.now() - 32 * 86400000).toISOString(),
      lastBarAt: new Date(Date.now() - 86400000).toISOString(),
      bars: makeBars(),
      coverageNote: 'IEX is a single US equity exchange feed, not consolidated SIP coverage.',
    });
    db.execute.mockResolvedValue(1);
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO quant_market_data_imports')) return [{ id: 'import-created-a' }];
      if (sql.includes('INSERT INTO quant_strategy_signals')) return [{ id: 'signal-created-a' }];
      if (sql.includes('FROM quant_market_data_imports')) return [importRow()];
      return [];
    });
  });

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env.ALPACA_API_KEY;
    else process.env.ALPACA_API_KEY = previousApiKey;
    if (previousApiSecret === undefined) delete process.env.ALPACA_API_SECRET;
    else process.env.ALPACA_API_SECRET = previousApiSecret;
    vi.restoreAllMocks();
  });

  it('imports normalized bars and records provider provenance for the authenticated user', async () => {
    const app = await appForUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/market-data/imports',
      payload: { symbol: 'SPY', limit: 250 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      import: {
        id: 'import-created-a',
        symbol: 'SPY',
        provider: 'alpaca',
        feed: 'iex',
        is_stale: false,
      },
      mode: 'historical_research_data',
    });
    expect(provider.fetch).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'SPY',
      limit: 250,
      apiKey: 'test-paper-key',
      apiSecret: 'test-paper-secret',
    }));
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO quant_market_data_imports'),
      userId, 'SPY', 'alpaca', 'iex', '1Day', 'all', 32,
      expect.any(String), expect.any(String), expect.any(String),
      expect.any(String), expect.any(String),
    );
    await app.close();
  });

  it('returns a safe not-configured response without exposing credentials', async () => {
    provider.fetch.mockRejectedValue(new MarketDataError(
      'not_configured', 'Alpaca market data is not configured.', 503,
    ));
    const app = await appForUser();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/market-data/imports',
      payload: { symbol: 'SPY' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'not_configured', provider: 'alpaca' });
    expect(response.body).not.toContain('test-paper-secret');
    await app.close();
  });

  it('lists only the authenticated user market-data imports', async () => {
    const app = await appForUser();
    const response = await app.inject({ method: 'GET', url: '/api/quant/market-data/imports' });
    expect(response.statusCode).toBe(200);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), userId);
    await app.close();
  });

  it('persists one idempotent SMA signal for an owned, fresh import', async () => {
    const app = await appForUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/strategy-signals',
      payload: { importId: 'import-owned-a', fastWindow: 5, slowWindow: 20 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      signal: {
        id: 'signal-created-a',
        symbol: 'SPY',
        action: 'hold',
        strategy: 'sma_crossover',
        importId: 'import-owned-a',
      },
      executionEnabled: false,
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND user_id = $2'),
      'import-owned-a', userId,
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (user_id, market_data_import_id'),
      userId, 'import-owned-a', 'sma_crossover', 5, 20, 'hold',
      100, 100, 100, 100, 100, expect.any(String), expect.any(String),
    );
    expect(response.json().message).toContain('No paper order was created');
    await app.close();
  });

  it('rejects a market-data import that does not belong to the authenticated user', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM quant_market_data_imports')) return [];
      return [];
    });
    const app = await appForUser();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/strategy-signals',
      payload: { importId: 'another-users-import' },
    });
    expect(response.statusCode).toBe(404);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO quant_strategy_signals'))).toBe(false);
    await app.close();
  });

  it('refuses to generate signals from stale stored market data', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM quant_market_data_imports')) {
        return [importRow({ last_bar_at: new Date(Date.now() - 10 * 86400000) })];
      }
      return [];
    });
    const app = await appForUser();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/strategy-signals',
      payload: { importId: 'import-owned-a' },
    });
    expect(response.statusCode).toBe(409);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO quant_strategy_signals'))).toBe(false);
    await app.close();
  });

  it('returns only the authenticated user signal history', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM quant_strategy_signals')) return [{ id: 'signal-owned-a', action: 'hold' }];
      return [];
    });
    const app = await appForUser();
    const response = await app.inject({ method: 'GET', url: '/api/quant/strategy-signals' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ signals: [{ id: 'signal-owned-a' }], executionEnabled: false });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE s.user_id = $1'), userId);
    await app.close();
  });
});
