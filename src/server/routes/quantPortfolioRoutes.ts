import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { requireUser } from './auth.js';

type Bar = { date: string; open: number; high: number; low: number; close: number; volume?: number };
type Input = {
  mode: 'portfolio_optimization';
  assets: Array<{ symbol: string; bars: Bar[] }>;
  min_weight?: number; max_weight?: number; max_turnover?: number;
  transaction_cost_bps?: number; risk_aversion?: number; covariance_shrinkage?: number;
  current_weights?: Record<string, number>;
};
type EngineResponse = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

const MAX_OUTPUT_BYTES = 4_000_000;
const ENGINE_TIMEOUT_MS = 15_000;

function runOptimizer(input: Input): Promise<EngineResponse> {
  return new Promise((resolve, reject) => {
    const script = path.resolve(process.cwd(), 'quant-engine/quant_engine.py');
    const python = process.env.RYANAI_PYTHON_BIN?.trim() || 'python3';
    const child = spawn(python, ['-I', script], {
      cwd: process.cwd(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, result?: EngineResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Portfolio optimizer timed out.'));
    }, ENGINE_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('Portfolio optimizer output exceeded the limit.'));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) return;
      try {
        const parsed = JSON.parse(stdout) as EngineResponse;
        if (code !== 0 && parsed.ok) finish(new Error('Portfolio optimizer exited unexpectedly.'));
        else finish(undefined, parsed);
      } catch {
        finish(new Error(stderr || 'Portfolio optimizer returned invalid output.'));
      }
    });
    child.stdin.on('error', (error) => finish(error));
    child.stdin.end(JSON.stringify(input));
  });
}

export const quantPortfolioRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);
  fastify.post<{ Body: {
    market_data_import_ids: string[];
    min_weight?: number; max_weight?: number; max_turnover?: number;
    transaction_cost_bps?: number; risk_aversion?: number; covariance_shrinkage?: number;
    current_weights?: Record<string, number>;
  } }>('/api/quant/portfolio/optimize', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    schema: { body: {
      type: 'object', additionalProperties: false, required: ['market_data_import_ids'],
      properties: {
        market_data_import_ids: { type: 'array', minItems: 2, maxItems: 25, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 64 } },
        min_weight: { type: 'number', minimum: 0, maximum: 1 },
        max_weight: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        max_turnover: { type: 'number', minimum: 0, maximum: 2 },
        transaction_cost_bps: { type: 'number', minimum: 0, maximum: 1000 },
        risk_aversion: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
        covariance_shrinkage: { type: 'number', minimum: 0, maximum: 1 },
        current_weights: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } },
      },
    } },
  }, async (request, reply) => {
    const ids = request.body.market_data_import_ids;
    const imports = await fastify.prisma.quantMarketDataImport.findMany({
      where: { id: { in: ids }, userId: request.authUser!.id },
    });
    if (imports.length !== ids.length) {
      return reply.code(404).send({ error: 'One or more market-data imports were not found for this account.' });
    }
    const first = imports[0];
    if (imports.some((item) => item.provider !== first.provider || item.feed !== first.feed ||
      item.timeframe !== first.timeframe || item.adjustment !== first.adjustment)) {
      return reply.code(409).send({ error: 'All assets must use the same provider, feed, timeframe, and adjustment mode.' });
    }
    if (first.timeframe !== '1Day') return reply.code(409).send({ error: 'Daily historical bars are required.' });
    if (imports.some((item) => item.isStale || !Number.isFinite(item.lastBarAt.getTime()) ||
      Date.now() - item.lastBarAt.getTime() > 5 * 86400000)) {
      return reply.code(409).send({ error: 'One or more market-data imports are stale. Refresh all assets first.' });
    }
    const assets = imports.map((item) => {
      if (!Array.isArray(item.bars) || item.bars.length < 31) throw new Error('Insufficient stored daily bars.');
      return { symbol: item.symbol, bars: item.bars as unknown as Bar[] };
    });
    const input: Input = {
      mode: 'portfolio_optimization', assets,
      min_weight: request.body.min_weight, max_weight: request.body.max_weight,
      max_turnover: request.body.max_turnover, transaction_cost_bps: request.body.transaction_cost_bps,
      risk_aversion: request.body.risk_aversion, covariance_shrinkage: request.body.covariance_shrinkage,
      current_weights: request.body.current_weights,
    };
    let engine: EngineResponse;
    try { engine = await runOptimizer(input); }
    catch (error) {
      fastify.log.error({ message: error instanceof Error ? error.message : 'unknown' }, 'Quant portfolio optimizer failed');
      return reply.code(503).send({ error: 'Quant portfolio optimizer is unavailable or did not complete safely.' });
    }
    if (!engine.ok) return reply.code(422).send({ error: engine.error });
    const saved = await fastify.prisma.quantExperiment.create({ data: {
      userId: request.authUser!.id, strategy: 'constrained_portfolio_optimization',
      status: 'completed', input: input as unknown as Prisma.InputJsonValue,
      result: engine.result as Prisma.InputJsonValue,
    }, select: { id: true, strategy: true, status: true, createdAt: true } });
    return reply.code(201).send({
      experiment: saved, result: engine.result, executionMode: 'research_only_no_orders',
      marketData: imports.map((item) => ({
        id: item.id, symbol: item.symbol, provider: item.provider, feed: item.feed,
        timeframe: item.timeframe, adjustment: item.adjustment, fetchedAt: item.fetchedAt,
        lastBarAt: item.lastBarAt, provenance: item.provenance,
      })),
    });
  });
};
