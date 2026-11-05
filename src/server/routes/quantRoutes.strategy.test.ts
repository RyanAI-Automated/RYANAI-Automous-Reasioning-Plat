import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    quantExperiment: { create: vi.fn(), findMany: vi.fn(), findFirst: mocks.findFirst },
    $executeRawUnsafe: mocks.execute,
    $queryRawUnsafe: mocks.query,
    $transaction: mocks.transaction,
  },
}));

import { quantRoutes } from './quantRoutes.js';

const tx = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn() };

async function appForUser() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = { id: 'strategy-user-a', role: 'user', isOwner: false };
  });
  await app.register(quantRoutes);
  return app;
}

describe('Quant paper strategy promotion routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      id: 'experiment-a', strategy: 'sma_crossover', status: 'completed',
      result: { metrics: { total_return_pct: 8.2 } },
    });
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    tx.$executeRawUnsafe.mockResolvedValue(1);
    tx.$queryRawUnsafe.mockImplementation(async (query: string) => {
      if (query.includes('SUM(allocation_pct)')) return [{ allocated_pct: '20' }];
      if (query.includes('RETURNING id')) return [{ id: 'paper-strategy-1', allocation_pct: '10.00', enabled: true }];
      return [{ user_id: 'strategy-user-a' }];
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('promotes only a completed experiment owned by the authenticated user', async () => {
    const app = await appForUser();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/paper/strategies',
      payload: { experimentId: 'experiment-a', allocationPct: 10 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      strategy: { experimentId: 'experiment-a', name: 'sma_crossover', allocation_pct: '10.00', enabled: true },
      mode: 'paper_plan_only', executionEnabled: false,
    });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'experiment-a', userId: 'strategy-user-a', status: 'completed' },
    }));
    expect(mocks.transaction).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects a promotion that would exceed the 100 percent portfolio allocation', async () => {
    tx.$queryRawUnsafe.mockImplementation(async (query: string) => {
      if (query.includes('SUM(allocation_pct)')) return [{ allocated_pct: '95' }];
      return [{ user_id: 'strategy-user-a' }];
    });
    const app = await appForUser();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/paper/strategies',
      payload: { experimentId: 'experiment-a', allocationPct: 10 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('cannot exceed 100%');
    expect(tx.$executeRawUnsafe.mock.calls.some(([query]) => String(query).includes('INSERT INTO quant_paper_strategies'))).toBe(false);
    await app.close();
  });

  it('does not promote an experiment that is missing or not owned by this user', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const app = await appForUser();
    const response = await app.inject({
      method: 'POST', url: '/api/quant/paper/strategies',
      payload: { experimentId: 'another-users-experiment', allocationPct: 10 },
    });
    expect(response.statusCode).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns only the authenticated user paper strategies', async () => {
    mocks.query.mockResolvedValue([{
      id: 'paper-strategy-1', experiment_id: 'experiment-a',
      strategy: 'sma_crossover', allocation_pct: '10.00', enabled: true,
      created_at: new Date(), metrics: { total_return_pct: 8.2 },
    }]);
    const app = await appForUser();
    const response = await app.inject({ method: 'GET', url: '/api/quant/paper/strategies' });
    expect(response.statusCode).toBe(200);
    expect(response.json().totalAllocationPct).toBe(10);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE s.user_id = $1'), 'strategy-user-a');
    await app.close();
  });

  it('removes only the current user strategy allocation', async () => {
    mocks.execute.mockResolvedValue(1);
    const app = await appForUser();
    const response = await app.inject({ method: 'DELETE', url: '/api/quant/paper/strategies/experiment-a' });
    expect(response.statusCode).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = $1 AND experiment_id = $2'),
      'strategy-user-a', 'experiment-a',
    );
    await app.close();
  });
});
