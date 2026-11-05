import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { requireUser } from './auth.js';
import {
  optimizeLongOnlyPortfolio,
  type PortfolioAssetHistory,
} from '../quant/portfolioOptimizer.js';

type OptimizeBody = {
  market_data_import_ids: string[];
  investedWeight?: number;
  maxWeight?: number;
  maxTurnoverPct?: number;
  transactionCostBps?: number;
  riskFreeRatePct?: number;
  maxAnnualizedVolatilityPct?: number;
  currentWeights?: Record<string, number>;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export const quantPortfolioOptimizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);

  fastify.post<{ Body: OptimizeBody }>('/api/quant/portfolio/optimize', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['market_data_import_ids'],
        properties: {
          market_data_import_ids: {
            type: 'array', minItems: 2, maxItems: 20, uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
          investedWeight: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
          maxWeight: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
          maxTurnoverPct: { type: 'number', minimum: 0, maximum: 100 },
          transactionCostBps: { type: 'number', minimum: 0, maximum: 1000 },
          riskFreeRatePct: { type: 'number', minimum: 0, maximum: 100 },
          maxAnnualizedVolatilityPct: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
          currentWeights: {
            type: 'object',
            additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  }, async (request, reply) => {
    const importIdPlaceholders = request.body.market_data_import_ids
      .map((_, index) => `${index + 2}`)
      .join(', ');
    const imports = await fastify.prisma.$queryRawUnsafe<Array<{
      id: string;
      symbol: string;
      provider: string;
      feed: string;
      timeframe: string;
      adjustment: string;
      last_bar_at: Date | string;
      fetched_at: Date | string;
      is_stale: boolean;
      bars: unknown;
    }>>(
      `SELECT id, symbol, provider, feed, timeframe, adjustment,
              last_bar_at, fetched_at, is_stale, bars
       FROM quant_market_data_imports
       WHERE user_id = $1 AND id IN (${importIdPlaceholders})
       ORDER BY symbol ASC`,
      request.authUser!.id,
      ...request.body.market_data_import_ids,
    );
    if (imports.length !== request.body.market_data_import_ids.length) {
      return reply.code(404).send({ error: 'One or more market-data imports were not found for this account.' });
    }
    const first = imports[0];
    if (imports.some((item) =>
      item.provider !== first.provider ||
      item.feed !== first.feed ||
      item.timeframe !== '1Day' ||
      item.timeframe !== first.timeframe ||
      item.adjustment !== first.adjustment
    )) {
      return reply.code(409).send({ error: 'Portfolio assets must share the same provider, feed, daily timeframe, and adjustment mode.' });
    }
    for (const item of imports) {
      const lastBarAt = asDate(item.last_bar_at).getTime();
      if (item.is_stale || !Number.isFinite(lastBarAt) ||
          lastBarAt > Date.now() + 5 * 60 * 1000 ||
          Date.now() - lastBarAt > 5 * 24 * 60 * 60 * 1000) {
        return reply.code(409).send({ error: 'All selected market-data imports must be recent and non-stale.' });
      }
      if (!Array.isArray(item.bars)) {
        return reply.code(422).send({ error: 'A selected market-data import contains invalid historical bars.' });
      }
    }

    const assets: PortfolioAssetHistory[] = imports.map((item) => ({
      symbol: item.symbol,
      bars: item.bars as Array<{ date: string; close: number }>,
    }));
    let result: ReturnType<typeof optimizeLongOnlyPortfolio>;
    try {
      result = optimizeLongOnlyPortfolio({
        assets,
        investedWeight: request.body.investedWeight,
        maxWeight: request.body.maxWeight,
        maxTurnoverPct: request.body.maxTurnoverPct,
        transactionCostBps: request.body.transactionCostBps,
        riskFreeRatePct: request.body.riskFreeRatePct,
        maxAnnualizedVolatilityPct: request.body.maxAnnualizedVolatilityPct,
        currentWeights: request.body.currentWeights,
      });
    } catch (error) {
      return reply.code(422).send({
        error: error instanceof Error ? error.message : 'Portfolio optimization could not satisfy the requested constraints.',
      });
    }

    const input = {
      market_data_import_ids: request.body.market_data_import_ids,
      investedWeight: request.body.investedWeight ?? 0.95,
      maxWeight: request.body.maxWeight ?? 0.5,
      maxTurnoverPct: request.body.maxTurnoverPct ?? 100,
      transactionCostBps: request.body.transactionCostBps ?? 10,
      riskFreeRatePct: request.body.riskFreeRatePct ?? 0,
      maxAnnualizedVolatilityPct: request.body.maxAnnualizedVolatilityPct ?? null,
      currentWeights: request.body.currentWeights ?? null,
    };
    const experiment = await fastify.prisma.quantExperiment.create({
      data: {
        userId: request.authUser!.id,
        strategy: 'minimum_variance_portfolio',
        status: 'completed',
        input: input as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, strategy: true, status: true, createdAt: true },
    });
    return reply.code(201).send({
      experiment,
      result,
      marketData: imports.map((item) => ({
        importId: item.id,
        symbol: item.symbol,
        provider: item.provider,
        feed: item.feed,
        timeframe: item.timeframe,
        adjustment: item.adjustment,
        fetchedAt: item.fetched_at,
        lastBarAt: item.last_bar_at,
      })),
      executionMode: 'research_allocation_only',
      ordersCreated: false,
      liveBrokerEnabled: false,
    });
  });
};
