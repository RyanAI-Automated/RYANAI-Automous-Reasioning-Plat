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
};
