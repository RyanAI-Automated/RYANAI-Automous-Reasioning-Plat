import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { requireUser } from './auth.js';
import { prisma } from '../../lib/prisma.js';

type Bar = { date: string; open: number; high: number; low: number; close: number; volume?: number };
type BacktestBody = {
  strategy?: 'sma_crossover';
  bars: Bar[];
  fast_window?: number;
  slow_window?: number;
  initial_cash?: number;
  fee_bps?: number;
  slippage_bps?: number;
};
type EngineResponse = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

const MAX_INPUT_BYTES = 2_000_000;
const MAX_OUTPUT_BYTES = 4_000_000;
const ENGINE_TIMEOUT_MS = 15_000;

function runPythonEngine(input: BacktestBody): Promise<EngineResponse> {
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
        required: ['bars'],
        properties: {
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
    const input: BacktestBody = { strategy: 'sma_crossover', ...request.body };
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
        input: input as unknown as Prisma.InputJsonValue,
        result: engine.result as Prisma.InputJsonValue,
      },
      select: { id: true, strategy: true, status: true, createdAt: true },
    });
    return reply.code(201).send({
      experiment: saved,
      result: engine.result,
      executionMode: 'historical_simulation_only',
    });
  });

  // Paper trading is a separate, explicitly simulated ledger. It never calls a broker.
  fastify.get('/api/quant/paper', async (request) => {
    const userId = request.authUser!.id;
    await prisma.$executeRawUnsafe(
      'INSERT INTO quant_paper_accounts (user_id, cash_balance, created_at, updated_at) VALUES ($1, 100000, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING',
      userId,
    );
    const [accounts, positions, trades] = await Promise.all([
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
    ]);
    const cash = Number(accounts[0]?.cash_balance ?? 0);
    const marketValue = positions.reduce((sum, row) => sum + Number(row.market_value), 0);
    return {
      mode: 'paper_simulation_only',
      brokerConnected: false,
      risk: { maxOrderNotional: 10000, feeBps: 5, shortSelling: false },
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
          const prior = await tx.$queryRawUnsafe<Array<{ id: string; status: string }>>(
            'SELECT id, status FROM quant_paper_orders WHERE user_id = $1 AND client_order_id = $2',
            userId, request.body.client_order_id,
          );
          if (prior.length) return { duplicate: true, orderId: prior[0].id, status: prior[0].status };
          const cash = Number(accounts[0]?.cash_balance ?? 0);
          const positions = await tx.$queryRawUnsafe<Array<{ quantity: string; average_entry_price: string }>>(
            'SELECT quantity::text, average_entry_price::text FROM quant_paper_positions WHERE user_id = $1 AND symbol = $2 FOR UPDATE',
            userId, symbol,
          );
          const held = Number(positions[0]?.quantity ?? 0);
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
          return { duplicate: false, orderId: orders[0].id, status: 'filled', symbol, side: request.body.side, quantity, fillPrice: price, fee, realizedPnl };
        });
        if (result.duplicate) return reply.code(200).send(result);
        return reply.code(201).send({ ...result, mode: 'paper_simulation_only', brokerConnected: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'INSUFFICIENT_PAPER_CASH') return reply.code(409).send({ error: 'Insufficient simulated cash for this order, including fees.' });
        if (message === 'INSUFFICIENT_PAPER_POSITION') return reply.code(409).send({ error: 'You cannot sell more units than your simulated position holds.' });
        fastify.log.error({ message: 'paper order transaction failed' }, 'Paper order rejected');
        return reply.code(503).send({ error: 'Paper order could not be safely recorded.' });
      }
    },
  );

};
