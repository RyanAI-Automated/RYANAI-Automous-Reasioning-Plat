import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { requireUser } from './auth.js';
import { prisma } from '../../lib/prisma.js';
import { fetchAlpacaDailyBars, MarketDataError } from '../quant/alpacaMarketData.js';
import { createSmaCrossoverSignal } from '../quant/strategySignal.js';
import { assessPaperOrderRisk } from '../quant/paperRisk.js';
import { quantPaperProposalRoutes } from './quantPaperProposalRoutes.js';

type Bar = { date: string; open: number; high: number; low: number; close: number; volume?: number };
type BacktestBody = {
  strategy?: 'sma_crossover';
  bars?: Bar[];
  market_data_import_id?: string;
  fast_window?: number;
  slow_window?: number;
  initial_cash?: number;
  fee_bps?: number;
  slippage_bps?: number;
};
type EngineInput = Omit<BacktestBody, 'bars' | 'market_data_import_id'> & { bars: Bar[] };
type EngineResponse = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

const MAX_INPUT_BYTES = 2_000_000;
const MAX_OUTPUT_BYTES = 4_000_000;
const ENGINE_TIMEOUT_MS = 15_000;

function runPythonEngine(input: EngineInput): Promise<EngineResponse> {
  return new Promise((resolve, reject) => {
    const script = path.resolve(process.cwd(), 'quant-engine/quant_engine.py');
    const python = process.env.RYANAI_PYTHON_BIN?.trim() || 'python3';
    const child = spawn(python, ['-I', script], {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '' },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, response?: EngineResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(response!);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Quant engine execution timed out.'));
    }, ENGINE_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('Quant engine output exceeded the safety limit.'));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', () => finish(new Error('The isolated Python quant engine is unavailable.')));
    child.on('close', (code) => {
      if (settled) return;
      let parsed: EngineResponse;
      try {
        parsed = JSON.parse(stdout) as EngineResponse;
      } catch {
        finish(new Error(stderr ? 'Quant engine returned an invalid response.' : 'Quant engine did not return a response.'));
        return;
      }
      if (code === 0 && parsed.ok) finish(undefined, parsed);
      else if (parsed && parsed.ok === false) finish(undefined, parsed);
      else finish(new Error('Quant engine failed without a valid error response.'));
    });
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body, 'utf8') > MAX_INPUT_BYTES) {
      child.kill('SIGKILL');
      finish(new Error('Backtest input exceeds the 2 MB limit.'));
      return;
    }
    child.stdin.end(body);
  });
}

export const quantRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);

  fastify.get('/api/quant/market-data/imports', async (request) => {
    const imports = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, symbol, provider, feed, timeframe, adjustment, bar_count,
              first_bar_at, last_bar_at, fetched_at,
              (is_stale OR last_bar_at < NOW() - INTERVAL '5 days') AS is_stale,
              provenance
       FROM quant_market_data_imports
       WHERE user_id = $1
       ORDER BY fetched_at DESC
       LIMIT 20`,
      request.authUser!.id,
    );
    return { imports };
  });

  fastify.post<{ Body: { symbol: string; limit?: number } }>('/api/quant/market-data/imports', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol'],
        properties: {
          symbol: { type: 'string', minLength: 1, maxLength: 15 },
          limit: { type: 'integer', minimum: 30, maximum: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    let imported;
    try {
      imported = await fetchAlpacaDailyBars({
        symbol: request.body.symbol,
        limit: request.body.limit ?? 250,
        apiKey: process.env.ALPACA_API_KEY,
        apiSecret: process.env.ALPACA_API_SECRET,
      });
    } catch (error) {
      if (error instanceof MarketDataError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          code: error.code,
          lastBarAt: error.lastBarAt,
          provider: 'alpaca',
        });
      }
      fastify.log.error({ message: 'Market-data provider request failed.' });
      return reply.code(502).send({ error: 'Market-data provider request failed safely.' });
    }

    const provenance = {
      provider: imported.provider,
      feed: imported.feed,
      timeframe: imported.timeframe,
      adjustment: imported.adjustment,
      fetchedAt: imported.fetchedAt,
      firstBarAt: imported.firstBarAt,
      lastBarAt: imported.lastBarAt,
      coverageNote: imported.coverageNote,
    };
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO quant_market_data_imports
        (user_id, symbol, provider, feed, timeframe, adjustment, bar_count,
         first_bar_at, last_bar_at, fetched_at, is_stale, bars, provenance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11::jsonb, $12::jsonb)
       RETURNING id`,
      request.authUser!.id,
      imported.symbol,
      imported.provider,
      imported.feed,
      imported.timeframe,
      imported.adjustment,
      imported.bars.length,
      imported.firstBarAt,
      imported.lastBarAt,
      imported.fetchedAt,
      JSON.stringify(imported.bars),
      JSON.stringify(provenance),
    );
    return reply.code(201).send({
      import: {
        id: rows[0].id,
        symbol: imported.symbol,
        provider: imported.provider,
        feed: imported.feed,
        timeframe: imported.timeframe,
        adjustment: imported.adjustment,
        bar_count: imported.bars.length,
        first_bar_at: imported.firstBarAt,
        last_bar_at: imported.lastBarAt,
        fetched_at: imported.fetchedAt,
        is_stale: false,
        provenance,
      },
      mode: 'historical_research_data',
    });
  });

  fastify.get('/api/quant/strategy-signals', async (request) => {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT s.id, s.market_data_import_id, i.symbol, s.strategy, s.fast_window,
              s.slow_window, s.action, s.reference_price::text,
              s.previous_fast_sma::text, s.previous_slow_sma::text,
              s.fast_sma::text, s.slow_sma::text, s.generated_at, s.metadata
       FROM quant_strategy_signals s
       INNER JOIN quant_market_data_imports i
         ON i.id = s.market_data_import_id AND i.user_id = s.user_id
       WHERE s.user_id = $1
       ORDER BY s.generated_at DESC
       LIMIT 30`,
      request.authUser!.id,
    );
    const signals = rows.map((row) => {
      const metadata = row.metadata && typeof row.metadata === 'object'
        ? row.metadata as Record<string, unknown>
        : {};
      return {
        id: row.id,
        importId: row.market_data_import_id,
        symbol: row.symbol,
        strategy: row.strategy,
        fastWindow: Number(row.fast_window),
        slowWindow: Number(row.slow_window),
        action: row.action,
        referencePrice: Number(row.reference_price),
        previousFastSma: Number(row.previous_fast_sma),
        previousSlowSma: Number(row.previous_slow_sma),
        fastSma: Number(row.fast_sma),
        slowSma: Number(row.slow_sma),
        generatedAt: row.generated_at,
        sourceBarDate: metadata.sourceBarDate,
      };
    });
    return { signals, executionEnabled: false };
  });

  fastify.post<{ Body: { importId: string; fastWindow?: number; slowWindow?: number } }>('/api/quant/strategy-signals', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['importId'],
        properties: {
          importId: { type: 'string', minLength: 1, maxLength: 64 },
          fastWindow: { type: 'integer', minimum: 2, maximum: 50 },
          slowWindow: { type: 'integer', minimum: 3, maximum: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser!.id;
    const fastWindow = request.body.fastWindow ?? 5;
    const slowWindow = request.body.slowWindow ?? 20;
    if (fastWindow >= slowWindow) {
      return reply.code(400).send({ error: 'Slow SMA window must be greater than the fast SMA window.' });
    }
    const imports = await prisma.$queryRawUnsafe<Array<{
      id: string;
      symbol: string;
      last_bar_at: Date | string;
      is_stale: boolean;
      bars: Bar[];
      provenance: Record<string, unknown>;
    }>>(
      `SELECT id, symbol, last_bar_at, is_stale, bars, provenance
       FROM quant_market_data_imports
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      request.body.importId,
      userId,
    );
    const imported = imports[0];
    if (!imported) return reply.code(404).send({ error: 'Market-data import not found for this account.' });
    const lastBarAt = new Date(imported.last_bar_at).getTime();
    if (imported.is_stale || !Number.isFinite(lastBarAt) || Date.now() - lastBarAt > 5 * 24 * 60 * 60 * 1000) {
      return reply.code(409).send({ error: 'Market-data import is stale. Refresh it before generating a signal.' });
    }
    if (!Array.isArray(imported.bars)) {
      return reply.code(422).send({ error: 'Stored market-data import has an invalid bar set.' });
    }

    let signal;
    try {
      signal = createSmaCrossoverSignal(imported.bars, fastWindow, slowWindow);
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : 'Signal validation failed.' });
    }
    const metadata = {
      source: 'alpaca',
      feed: imported.provenance?.feed ?? 'unknown',
      sourceBarDate: signal.sourceBarDate,
      generatedFromImportId: imported.id,
      description: 'A research signal only. It does not create, schedule or execute a paper order.',
    };
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO quant_strategy_signals
        (user_id, market_data_import_id, strategy, fast_window, slow_window, action,
         reference_price, previous_fast_sma, previous_slow_sma, fast_sma, slow_sma,
         generated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (user_id, market_data_import_id, strategy, fast_window, slow_window)
       DO UPDATE SET action = EXCLUDED.action, reference_price = EXCLUDED.reference_price,
         previous_fast_sma = EXCLUDED.previous_fast_sma, previous_slow_sma = EXCLUDED.previous_slow_sma,
         fast_sma = EXCLUDED.fast_sma, slow_sma = EXCLUDED.slow_sma,
         generated_at = EXCLUDED.generated_at, metadata = EXCLUDED.metadata
       RETURNING id`,
      userId,
      imported.id,
      signal.strategy,
      fastWindow,
      slowWindow,
      signal.action,
      signal.referencePrice,
      signal.previousFastSma,
      signal.previousSlowSma,
      signal.fastSma,
      signal.slowSma,
      signal.generatedAt,
      JSON.stringify(metadata),
    );
    return reply.code(201).send({
      signal: { id: rows[0].id, symbol: imported.symbol, ...signal, importId: imported.id, metadata },
      executionEnabled: false,
      message: 'Signal saved for research. No paper order was created.',
    });
  });

  fastify.get('/api/quant/experiments', async (request) => {
    const experiments = await prisma.quantExperiment.findMany({
      where: { userId: request.authUser!.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, strategy: true, status: true, createdAt: true, result: true },
    });
    return { experiments };
  });

  fastify.get<{ Params: { experimentId: string } }>(
    '/api/quant/experiments/:experimentId',
    async (request, reply) => {
      const experiment = await prisma.quantExperiment.findFirst({
        where: { id: request.params.experimentId, userId: request.authUser!.id },
        select: { id: true, strategy: true, status: true, input: true, result: true, createdAt: true },
      });
      if (!experiment) return reply.code(404).send({ error: 'Quant experiment not found.' });
      return { experiment };
    },
  );

  fastify.post<{ Body: BacktestBody }>('/api/quant/backtests', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        anyOf: [{ required: ['bars'] }, { required: ['market_data_import_id'] }],
        properties: {
          market_data_import_id: { type: 'string', minLength: 1, maxLength: 64 },
          strategy: { type: 'string', enum: ['sma_crossover'] },
          bars: {
            type: 'array', minItems: 30, maxItems: 2500,
            items: {
              type: 'object', additionalProperties: false,
              required: ['date', 'open', 'high', 'low', 'close'],
              properties: {
                date: { type: 'string', format: 'date' },
                open: { type: 'number', exclusiveMinimum: 0 },
                high: { type: 'number', exclusiveMinimum: 0 },
                low: { type: 'number', exclusiveMinimum: 0 },
                close: { type: 'number', exclusiveMinimum: 0 },
                volume: { type: 'number', minimum: 0 },
              },
            },
          },
          fast_window: { type: 'integer', minimum: 2, maximum: 50 },
          slow_window: { type: 'integer', minimum: 3, maximum: 200 },
          initial_cash: { type: 'number', minimum: 1, maximum: 1000000000 },
          fee_bps: { type: 'number', minimum: 0, maximum: 1000 },
          slippage_bps: { type: 'number', minimum: 0, maximum: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    let bars = request.body.bars;
    let marketDataProvenance: Record<string, unknown> | null = null;
    if (request.body.market_data_import_id) {
      const imports = await prisma.$queryRawUnsafe<Array<{
        id: string; symbol: string; provider: string; feed: string; timeframe: string;
        adjustment: string; last_bar_at: Date | string; fetched_at: Date | string;
        is_stale: boolean; bars: Bar[]; provenance: Record<string, unknown>;
      }>>(
        `SELECT id, symbol, provider, feed, timeframe, adjustment, last_bar_at,
                fetched_at, is_stale, bars, provenance
         FROM quant_market_data_imports
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        request.body.market_data_import_id,
        request.authUser!.id,
      );
      const imported = imports[0];
      if (!imported) return reply.code(404).send({ error: 'Market-data import not found for this account.' });
      const lastBarAt = new Date(imported.last_bar_at).getTime();
      if (imported.is_stale || !Number.isFinite(lastBarAt) || Date.now() - lastBarAt > 5 * 24 * 60 * 60 * 1000) {
        return reply.code(409).send({ error: 'Market-data import is stale. Refresh it before running a backtest.' });
      }
      if (!Array.isArray(imported.bars) || imported.bars.length < 30) {
        return reply.code(422).send({ error: 'Stored market-data import does not contain enough valid bars.' });
      }
      bars = imported.bars;
      marketDataProvenance = {
        id: imported.id,
        symbol: imported.symbol,
        provider: imported.provider,
        feed: imported.feed,
        timeframe: imported.timeframe,
        adjustment: imported.adjustment,
        fetchedAt: imported.fetched_at,
        lastBarAt: imported.last_bar_at,
        ...(imported.provenance ?? {}),
      };
    }
    if (!bars) return reply.code(400).send({ error: 'Provide bars or select an owned market-data import.' });
    const input: EngineInput = {
      strategy: 'sma_crossover',
      bars,
      fast_window: request.body.fast_window,
      slow_window: request.body.slow_window,
      initial_cash: request.body.initial_cash,
      fee_bps: request.body.fee_bps,
      slippage_bps: request.body.slippage_bps,
    };
    if ((input.fast_window ?? 5) >= (input.slow_window ?? 20)) {
      return reply.code(400).send({ error: 'slow_window must be greater than fast_window.' });
    }
    let engine: EngineResponse;
    try {
      engine = await runPythonEngine(input);
    } catch (error) {
      fastify.log.error({ message: error instanceof Error ? error.message : 'unknown' }, 'Quant engine execution failed');
      return reply.code(503).send({ error: 'Quant engine is unavailable or did not complete safely.' });
    }
    if (!engine.ok) return reply.code(422).send({ error: engine.error });

    const saved = await prisma.quantExperiment.create({
      data: {
        userId: request.authUser!.id,
        strategy: 'sma_crossover',
        status: 'completed',
        input: {
          ...input,
          ...(request.body.market_data_import_id ? { market_data_import_id: request.body.market_data_import_id } : {}),
        } as unknown as Prisma.InputJsonValue,
        result: engine.result as Prisma.InputJsonValue,
      },
      select: { id: true, strategy: true, status: true, createdAt: true },
    });
    return reply.code(201).send({
      experiment: saved,
      result: engine.result,
      executionMode: 'historical_simulation_only',
      marketData: marketDataProvenance,
    });
  });

  // Paper trading is a separate, explicitly simulated ledger. It never calls a broker.
  fastify.get('/api/quant/paper', async (request) => {
    const userId = request.authUser!.id;
    await prisma.$executeRawUnsafe(
      'INSERT INTO quant_paper_accounts (user_id, cash_balance, created_at, updated_at) VALUES ($1, 100000, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING',
      userId,
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO quant_paper_risk_policies (user_id, created_at, updated_at) VALUES ($1, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING',
      userId,
    );
    const [accounts, positions, trades, policies] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ cash_balance: string }>>(
        'SELECT cash_balance::text FROM quant_paper_accounts WHERE user_id = $1', userId,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'SELECT symbol, quantity::text, average_entry_price::text, last_price::text, (quantity * last_price)::text AS market_value, ((last_price - average_entry_price) * quantity)::text AS unrealized_pnl FROM quant_paper_positions WHERE user_id = $1 AND quantity > 0 ORDER BY symbol',
        userId,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'SELECT id, symbol, side, quantity::text, price::text, fee::text, realized_pnl::text, created_at FROM quant_paper_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
        userId,
      ),
      prisma.$queryRawUnsafe<Array<{ max_order_notional: string; fee_bps: number; trading_enabled: boolean }>>(
        'SELECT max_order_notional::text, 5::integer AS fee_bps, trading_enabled FROM quant_paper_risk_policies WHERE user_id = $1',
        userId,
      ),
    ]);
    const cash = Number(accounts[0]?.cash_balance ?? 0);
    const marketValue = positions.reduce((sum, row) => sum + Number(row.market_value), 0);
    return {
      mode: 'paper_simulation_only',
      brokerConnected: false,
      risk: {
        maxOrderNotional: Number(policies[0]?.max_order_notional ?? 10000),
        feeBps: policies[0]?.fee_bps ?? 5,
        tradingEnabled: policies[0]?.trading_enabled ?? true,
        shortSelling: false,
      },
      account: { startingCash: 100000, cash, marketValue, equity: cash + marketValue },
      positions,
      trades,
    };
  });

  fastify.post<{ Body: { symbol: string; side: 'buy' | 'sell'; quantity: number; reference_price: number; client_order_id: string } }>(
    '/api/quant/paper/orders',
    {
      schema: {
        body: {
          type: 'object', additionalProperties: false,
          required: ['symbol', 'side', 'quantity', 'reference_price', 'client_order_id'],
          properties: {
            symbol: { type: 'string', pattern: '^[A-Za-z0-9.\\-]{1,15}$' },
            side: { type: 'string', enum: ['buy', 'sell'] },
            quantity: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
            reference_price: { type: 'number', exclusiveMinimum: 0, maximum: 10000000 },
            client_order_id: { type: 'string', minLength: 16, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.authUser!.id;
      const symbol = request.body.symbol.toUpperCase();
      const quantity = request.body.quantity;
      const price = request.body.reference_price;
      const notional = quantity * price;
      const fee = notional * 0.0005;
      if (!Number.isFinite(notional) || notional > 10000) {
        return reply.code(400).send({ error: 'Paper orders are limited to 10,000 in simulated notional.' });
      }
      try {
        const result = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            'INSERT INTO quant_paper_accounts (user_id, cash_balance, created_at, updated_at) VALUES ($1, 100000, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING',
            userId,
          );
          const accounts = await tx.$queryRawUnsafe<Array<{ cash_balance: string }>>(
            'SELECT cash_balance::text FROM quant_paper_accounts WHERE user_id = $1 FOR UPDATE',
            userId,
          );
          await tx.$executeRawUnsafe(
            'INSERT INTO quant_paper_risk_policies (user_id, created_at, updated_at) VALUES ($1, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING',
            userId,
          );
          const policies = await tx.$queryRawUnsafe<Array<{
            max_order_notional: string; max_position_notional: string;
            max_gross_exposure: string; max_daily_loss: string;
            max_drawdown_pct: string; trading_enabled: boolean;
            emergency_stop: boolean; emergency_stop_reason: string | null;
          }>>(
            'SELECT max_order_notional::text, max_position_notional::text, max_gross_exposure::text, max_daily_loss::text, max_drawdown_pct::text, trading_enabled, emergency_stop, emergency_stop_reason FROM quant_paper_risk_policies WHERE user_id = $1 FOR UPDATE',
            userId,
          );
          const policy = policies[0] ?? {
            max_order_notional: '10000', max_position_notional: '25000',
            max_gross_exposure: '75000', max_daily_loss: '5000',
            max_drawdown_pct: '10', trading_enabled: true,
            emergency_stop: false, emergency_stop_reason: null,
          };
          const prior = await tx.$queryRawUnsafe<Array<{ id: string; status: string }>>(
            'SELECT id, status FROM quant_paper_orders WHERE user_id = $1 AND client_order_id = $2',
            userId, request.body.client_order_id,
          );
          if (prior.length) return { duplicate: true, riskBlocked: false, orderId: prior[0].id, status: prior[0].status };
          if (policy.emergency_stop) throw new Error('PAPER_EMERGENCY_STOP');
          if (!policy.trading_enabled) throw new Error('PAPER_TRADING_DISABLED');
          if (notional > Number(policy.max_order_notional)) throw new Error('PAPER_ORDER_RISK_LIMIT');
          const cash = Number(accounts[0]?.cash_balance ?? 0);
          const positions = await tx.$queryRawUnsafe<Array<{
            quantity: string; average_entry_price: string; last_price: string;
          }>>(
            'SELECT quantity::text, average_entry_price::text, last_price::text FROM quant_paper_positions WHERE user_id = $1 AND symbol = $2 FOR UPDATE',
            userId, symbol,
          );
          const held = Number(positions[0]?.quantity ?? 0);
          if (request.body.side === 'sell' && held < quantity) throw new Error('INSUFFICIENT_PAPER_POSITION');

          const exposureRows = await tx.$queryRawUnsafe<Array<{ gross_exposure: string }>>(
            'SELECT COALESCE(SUM(quantity * last_price), 0)::text AS gross_exposure FROM quant_paper_positions WHERE user_id = $1 AND quantity > 0',
            userId,
          );
          const grossExposure = Number(exposureRows[0]?.gross_exposure ?? 0);
          const heldMarkPrice = Number(positions[0]?.last_price ?? 0);
          const symbolExposure = held * heldMarkPrice;
          if (request.body.side === 'buy') {
            if (symbolExposure + notional > Number(policy.max_position_notional)) throw new Error('PAPER_POSITION_RISK_LIMIT');
            if (grossExposure + notional > Number(policy.max_gross_exposure)) throw new Error('PAPER_GROSS_RISK_LIMIT');
          }

          // Capture each UTC day's opening equity and the lifetime peak once.
          // Marks are the latest stored paper fill prices, not live quotes.
          await tx.$executeRawUnsafe(
            `INSERT INTO quant_paper_daily_risk_state
              (user_id, risk_date, starting_equity, current_equity, daily_loss, updated_at)
             SELECT a.user_id, CURRENT_DATE,
                    a.cash_balance + COALESCE(SUM(p.quantity * p.last_price), 0),
                    a.cash_balance + COALESCE(SUM(p.quantity * p.last_price), 0),
                    0, NOW()
             FROM quant_paper_accounts a
             LEFT JOIN quant_paper_positions p ON p.user_id = a.user_id AND p.quantity > 0
             WHERE a.user_id = $1
             GROUP BY a.user_id, a.cash_balance
             ON CONFLICT (user_id, risk_date) DO NOTHING`,
            userId,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO quant_paper_portfolio_risk_state
              (user_id, peak_equity, current_equity, max_drawdown_pct, updated_at)
             SELECT a.user_id,
                    a.cash_balance + COALESCE(SUM(p.quantity * p.last_price), 0),
                    a.cash_balance + COALESCE(SUM(p.quantity * p.last_price), 0),
                    0, NOW()
             FROM quant_paper_accounts a
             LEFT JOIN quant_paper_positions p ON p.user_id = a.user_id AND p.quantity > 0
             WHERE a.user_id = $1
             GROUP BY a.user_id, a.cash_balance
             ON CONFLICT (user_id) DO NOTHING`,
            userId,
          );
          const dailyRows = await tx.$queryRawUnsafe<Array<{ starting_equity: string }>>(
            'SELECT starting_equity::text FROM quant_paper_daily_risk_state WHERE user_id = $1 AND risk_date = CURRENT_DATE FOR UPDATE',
            userId,
          );
          const portfolioRows = await tx.$queryRawUnsafe<Array<{ peak_equity: string }>>(
            'SELECT peak_equity::text FROM quant_paper_portfolio_risk_state WHERE user_id = $1 FOR UPDATE',
            userId,
          );
          const assessment = assessPaperOrderRisk({
            cashBalance: cash,
            grossExposure,
            heldQuantity: held,
            heldMarkPrice,
            orderQuantity: quantity,
            referencePrice: price,
            fee,
            side: request.body.side,
            startingDailyEquity: Number(dailyRows[0]?.starting_equity ?? (cash + grossExposure)),
            lifetimePeakEquity: Number(portfolioRows[0]?.peak_equity ?? (cash + grossExposure)),
            limits: {
              maxDailyLoss: Number(policy.max_daily_loss ?? 5000),
              maxDrawdownPct: Number(policy.max_drawdown_pct ?? 10),
            },
          });
          if (assessment.breach) {
            await tx.$executeRawUnsafe(
              `UPDATE quant_paper_risk_policies
               SET emergency_stop = TRUE, trading_enabled = FALSE,
                   emergency_stop_reason = $2, emergency_stopped_at = NOW(), updated_at = NOW()
               WHERE user_id = $1`,
              userId, assessment.breach,
            );
            return { duplicate: false, riskBlocked: true, riskReason: assessment.breach };
          }

          const averageEntry = Number(positions[0]?.average_entry_price ?? 0);
          let realizedPnl = 0;
          if (request.body.side === 'buy') {
            if (cash < notional + fee) throw new Error('INSUFFICIENT_PAPER_CASH');
            await tx.$executeRawUnsafe(
              'UPDATE quant_paper_accounts SET cash_balance = cash_balance - $2, updated_at = NOW() WHERE user_id = $1',
              userId, notional + fee,
            );
            await tx.$executeRawUnsafe(
              'INSERT INTO quant_paper_positions (user_id, symbol, quantity, average_entry_price, last_price, updated_at) VALUES ($1, $2, $3, $4, $4, NOW()) ON CONFLICT (user_id, symbol) DO UPDATE SET average_entry_price = ((quant_paper_positions.quantity * quant_paper_positions.average_entry_price) + (EXCLUDED.quantity * EXCLUDED.average_entry_price)) / (quant_paper_positions.quantity + EXCLUDED.quantity), quantity = quant_paper_positions.quantity + EXCLUDED.quantity, last_price = EXCLUDED.last_price, updated_at = NOW()',
              userId, symbol, quantity, price,
            );
          } else {
            if (held < quantity) throw new Error('INSUFFICIENT_PAPER_POSITION');
            realizedPnl = (price - averageEntry) * quantity - fee;
            await tx.$executeRawUnsafe(
              'UPDATE quant_paper_accounts SET cash_balance = cash_balance + $2, updated_at = NOW() WHERE user_id = $1',
              userId, notional - fee,
            );
            await tx.$executeRawUnsafe(
              'UPDATE quant_paper_positions SET quantity = quantity - $3, last_price = $4, updated_at = NOW() WHERE user_id = $1 AND symbol = $2',
              userId, symbol, quantity, price,
            );
            await tx.$executeRawUnsafe(
              'DELETE FROM quant_paper_positions WHERE user_id = $1 AND symbol = $2 AND quantity <= 0',
              userId, symbol,
            );
          }
          const orders = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            "INSERT INTO quant_paper_orders (user_id, client_order_id, symbol, side, quantity, reference_price, fill_price, fee, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'filled', NOW()) RETURNING id",
            userId, request.body.client_order_id, symbol, request.body.side, quantity, price, fee,
          );
          await tx.$executeRawUnsafe(
            'INSERT INTO quant_paper_trades (order_id, user_id, symbol, side, quantity, price, fee, realized_pnl, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())',
            orders[0].id, userId, symbol, request.body.side, quantity, price, fee, request.body.side === 'sell' ? realizedPnl : null,
          );
          await tx.$executeRawUnsafe(
            `UPDATE quant_paper_daily_risk_state
             SET current_equity = $2, daily_loss = $3, updated_at = NOW()
             WHERE user_id = $1 AND risk_date = CURRENT_DATE`,
            userId, assessment.projectedEquity, assessment.dailyLoss,
          );
          await tx.$executeRawUnsafe(
            `UPDATE quant_paper_portfolio_risk_state
             SET peak_equity = $2, current_equity = $3,
                 max_drawdown_pct = GREATEST(max_drawdown_pct, $4), updated_at = NOW()
             WHERE user_id = $1`,
            userId, assessment.peakEquityAfterOrder, assessment.projectedEquity, assessment.drawdownPct,
          );
          return {
            duplicate: false, riskBlocked: false, orderId: orders[0].id,
            status: 'filled', symbol, side: request.body.side, quantity,
            fillPrice: price, fee, realizedPnl,
          };
        });
        if (result.riskBlocked) {
          return reply.code(423).send({
            error: result.riskReason === 'daily_loss_limit'
              ? 'Emergency stop activated: the projected paper fill breaches the daily loss limit.'
              : 'Emergency stop activated: the projected paper fill breaches the drawdown limit.',
            emergencyStop: true,
            reason: result.riskReason,
            orderPlaced: false,
          });
        }
        if (result.duplicate) return reply.code(200).send(result);
        return reply.code(201).send({ ...result, mode: 'paper_simulation_only', brokerConnected: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'INSUFFICIENT_PAPER_CASH') return reply.code(409).send({ error: 'Insufficient simulated cash for this order, including fees.' });
        if (message === 'INSUFFICIENT_PAPER_POSITION') return reply.code(409).send({ error: 'You cannot sell more units than your simulated position holds.' });
        if (message === 'PAPER_EMERGENCY_STOP') return reply.code(423).send({ error: 'Emergency stop is active. Explicitly reset it before placing paper orders.', emergencyStop: true });
        if (message === 'PAPER_TRADING_DISABLED') return reply.code(423).send({ error: 'Paper trading is paused by your risk policy.' });
        if (message === 'PAPER_ORDER_RISK_LIMIT') return reply.code(409).send({ error: 'Order exceeds your configured per-order risk limit.' });
        if (message === 'PAPER_POSITION_RISK_LIMIT') return reply.code(409).send({ error: 'Order would exceed your configured single-position exposure limit.' });
        if (message === 'PAPER_GROSS_RISK_LIMIT') return reply.code(409).send({ error: 'Order would exceed your configured total portfolio exposure limit.' });
        fastify.log.error({ message: 'paper order transaction failed' }, 'Paper order rejected');
        return reply.code(503).send({ error: 'Paper order could not be safely recorded.' });
      }
    },
  );


  // User-adjustable paper-risk policy. Server-side hard caps remain authoritative.
  fastify.get('/api/quant/paper/risk', async (request) => {
    const userId = request.authUser!.id;
    await prisma.$executeRawUnsafe(
      'INSERT INTO quant_paper_risk_policies (user_id, created_at, updated_at) VALUES ($1, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING',
      userId,
    );
    const rows = await prisma.$queryRawUnsafe<Array<{
      max_order_notional: string; max_position_notional: string;
      max_gross_exposure: string; trading_enabled: boolean;
    }>>(
      'SELECT max_order_notional::text, max_position_notional::text, max_gross_exposure::text, trading_enabled FROM quant_paper_risk_policies WHERE user_id = $1',
      userId,
    );
    const policy = rows[0];
    return {
      tradingEnabled: policy?.trading_enabled ?? true,
      maxOrderNotional: Number(policy?.max_order_notional ?? 10000),
      maxPositionNotional: Number(policy?.max_position_notional ?? 25000),
      maxGrossExposure: Number(policy?.max_gross_exposure ?? 75000),
      hardCaps: { maxOrderNotional: 10000, maxPositionNotional: 50000, maxGrossExposure: 100000 },
      shortSelling: false,
      mode: 'paper_simulation_only',
    };
  });

  fastify.put<{ Body: {
    tradingEnabled: boolean;
    maxOrderNotional: number;
    maxPositionNotional: number;
    maxGrossExposure: number;
  } }>('/api/quant/paper/risk', {
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['tradingEnabled', 'maxOrderNotional', 'maxPositionNotional', 'maxGrossExposure'],
        properties: {
          tradingEnabled: { type: 'boolean' },
          maxOrderNotional: { type: 'number', minimum: 100, maximum: 10000 },
          maxPositionNotional: { type: 'number', minimum: 100, maximum: 50000 },
          maxGrossExposure: { type: 'number', minimum: 100, maximum: 100000 },
        },
      },
    },
  }, async (request, reply) => {
    const { tradingEnabled, maxOrderNotional, maxPositionNotional, maxGrossExposure } = request.body;
    if (maxOrderNotional > maxPositionNotional || maxPositionNotional > maxGrossExposure) {
      return reply.code(400).send({ error: 'Risk limits must satisfy order ≤ position ≤ gross exposure.' });
    }
    const userId = request.authUser!.id;
    const existingPolicy = await prisma.$queryRawUnsafe<Array<{ emergency_stop: boolean }>>(
      'SELECT emergency_stop FROM quant_paper_risk_policies WHERE user_id = $1',
      userId,
    );
    if (existingPolicy[0]?.emergency_stop && tradingEnabled) {
      return reply.code(423).send({ error: 'Reset the emergency stop explicitly before re-enabling paper trading.' });
    }
    await prisma.$executeRawUnsafe(
      'INSERT INTO quant_paper_risk_policies (user_id, max_order_notional, max_position_notional, max_gross_exposure, trading_enabled, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) ON CONFLICT (user_id) DO UPDATE SET max_order_notional = EXCLUDED.max_order_notional, max_position_notional = EXCLUDED.max_position_notional, max_gross_exposure = EXCLUDED.max_gross_exposure, trading_enabled = EXCLUDED.trading_enabled, updated_at = NOW()',
      userId, maxOrderNotional, maxPositionNotional, maxGrossExposure, tradingEnabled,
    );
    return reply.code(200).send({
      tradingEnabled, maxOrderNotional, maxPositionNotional, maxGrossExposure,
      hardCaps: { maxOrderNotional: 10000, maxPositionNotional: 50000, maxGrossExposure: 100000 },
      shortSelling: false, mode: 'paper_simulation_only',
    });
  });


  // Promote a completed, user-owned research experiment into a paper portfolio plan.
  // Promotion allocates a target budget only; it does not place or schedule orders.
  fastify.get('/api/quant/paper/strategies', async (request) => {
    const strategies = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      "SELECT s.id, s.experiment_id, e.strategy, s.allocation_pct::text, s.enabled, s.created_at, (e.result -> 'metrics') AS metrics FROM quant_paper_strategies s INNER JOIN quant_experiments e ON e.id = s.experiment_id AND e.user_id = s.user_id WHERE s.user_id = $1 ORDER BY s.created_at DESC",
      request.authUser!.id,
    );
    return { strategies, totalAllocationPct: strategies.filter((item) => item.enabled).reduce((sum, item) => sum + Number(item.allocation_pct), 0) };
  });

  fastify.post<{ Body: { experimentId: string; allocationPct: number } }>('/api/quant/paper/strategies', {
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['experimentId', 'allocationPct'],
        properties: {
          experimentId: { type: 'string', minLength: 1, maxLength: 64 },
          allocationPct: { type: 'number', minimum: 1, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser!.id;
    const experiment = await prisma.quantExperiment.findFirst({
      where: { id: request.body.experimentId, userId, status: 'completed' },
      select: { id: true, strategy: true, status: true, result: true },
    });
    if (!experiment || !experiment.result) {
      return reply.code(404).send({ error: 'Completed research experiment not found for this account.' });
    }

    const promoted = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'INSERT INTO quant_paper_accounts (user_id, cash_balance, created_at, updated_at) VALUES ($1, 100000, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING',
        userId,
      );
      await tx.$queryRawUnsafe<Array<{ user_id: string }>>(
        'SELECT user_id FROM quant_paper_accounts WHERE user_id = $1 FOR UPDATE',
        userId,
      );
      const allocations = await tx.$queryRawUnsafe<Array<{ allocated_pct: string }>>(
        'SELECT COALESCE(SUM(allocation_pct), 0)::text AS allocated_pct FROM quant_paper_strategies WHERE user_id = $1 AND enabled = TRUE AND experiment_id <> $2',
        userId, request.body.experimentId,
      );
      const committedPct = Number(allocations[0]?.allocated_pct ?? 0);
      if (committedPct + request.body.allocationPct > 100) {
        return { overAllocated: true as const, committedPct };
      }
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; allocation_pct: string; enabled: boolean }>>(
        'INSERT INTO quant_paper_strategies (user_id, experiment_id, allocation_pct, enabled, created_at, updated_at) VALUES ($1, $2, $3, TRUE, NOW(), NOW()) ON CONFLICT (user_id, experiment_id) DO UPDATE SET allocation_pct = EXCLUDED.allocation_pct, enabled = TRUE, updated_at = NOW() RETURNING id, allocation_pct::text, enabled',
        userId, request.body.experimentId, request.body.allocationPct,
      );
      return { overAllocated: false as const, strategy: rows[0] };
    });

    if (promoted.overAllocated) {
      return reply.code(409).send({
        error: 'Paper strategy allocations cannot exceed 100% of the portfolio.',
        committedAllocationPct: promoted.committedPct,
        requestedAllocationPct: request.body.allocationPct,
      });
    }
    return reply.code(201).send({
      strategy: {
        ...promoted.strategy,
        experimentId: request.body.experimentId,
        name: experiment.strategy,
      },
      mode: 'paper_plan_only',
      executionEnabled: false,
      message: 'Strategy added to the paper portfolio plan. No orders were placed.',
    });
  });

  fastify.delete<{ Params: { experimentId: string } }>(
    '/api/quant/paper/strategies/:experimentId',
    async (request, reply) => {
      const deleted = await prisma.$executeRawUnsafe(
        'DELETE FROM quant_paper_strategies WHERE user_id = $1 AND experiment_id = $2',
        request.authUser!.id, request.params.experimentId,
      );
      if (deleted === 0) return reply.code(404).send({ error: 'Paper portfolio strategy not found.' });
      return { removed: true, experimentId: request.params.experimentId };
    },
  );

  await fastify.register(quantPaperProposalRoutes);
};
