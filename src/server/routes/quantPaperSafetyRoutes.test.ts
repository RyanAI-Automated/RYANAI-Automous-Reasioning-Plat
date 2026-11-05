import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  emergencyStop: false,
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $executeRawUnsafe: mocks.execute,
    $queryRawUnsafe: mocks.query,
  },
}));

import { quantPaperSafetyRoutes } from './quantPaperSafetyRoutes.js';

async function createApp() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = { id: 'risk-owner-a', role: 'user', isOwner: false };
  });
  await app.register(quantPaperSafetyRoutes);
  return app;
}

describe('authenticated paper safety routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emergencyStop = false;
    mocks.execute.mockResolvedValue(1);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT emergency_stop')) return [{ emergency_stop: mocks.emergencyStop }];
      if (sql.includes('max_daily_loss::text')) {
        return [{
          max_daily_loss: '2500',
          max_drawdown_pct: '8',
          emergency_stop: mocks.emergencyStop,
          emergency_stop_reason: mocks.emergencyStop ? 'manual_emergency_stop' : null,
          emergency_stopped_at: null,
          trading_enabled: !mocks.emergencyStop,
        }];
      }
      if (sql.includes('daily_risk_state')) return [];
      if (sql.includes('portfolio_risk_state')) return [];
      return [];
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns account-scoped risk state and the current enforcement boundary', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/api/quant/paper/risk/state' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tradingEnabled: true,
      emergencyStop: false,
      maxDailyLoss: 2500,
      maxDrawdownPct: 8,
      mode: 'paper_simulation_only',
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), 'risk-owner-a');
    await app.close();
  });

  it('saves daily risk limits only while the emergency stop is inactive', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/quant/paper/risk/limits',
      payload: { maxDailyLoss: 3000, maxDrawdownPct: 12 },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET max_daily_loss = $2'),
      'risk-owner-a', 3000, 12,
    );
    await app.close();
  });

  it('latches the emergency stop and disables paper trading', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/risk/emergency-stop',
      payload: { reason: 'operator_request' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      emergencyStop: true,
      tradingEnabled: false,
      reason: 'operator_request',
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('emergency_stop = TRUE'),
      'risk-owner-a', 'operator_request',
    );
    await app.close();
  });

  it('requires explicit acknowledgement and leaves trading disabled after reset', async () => {
    const app = await createApp();
    const missingAck = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/risk/emergency-stop/reset',
      payload: { acknowledge: false },
    });
    expect(missingAck.statusCode).toBe(400);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/quant/paper/risk/emergency-stop/reset',
      payload: { acknowledge: true },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ emergencyStop: false, tradingEnabled: false });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('trading_enabled = FALSE'),
      'risk-owner-a',
    );
    await app.close();
  });

  it('refuses to change limits while the emergency stop is active', async () => {
    mocks.emergencyStop = true;
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/quant/paper/risk/limits',
      payload: { maxDailyLoss: 3000, maxDrawdownPct: 12 },
    });
    expect(response.statusCode).toBe(423);
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes('SET max_daily_loss'))).toBe(false);
    await app.close();
  });
});
