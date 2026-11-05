import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';
import { reconcilePaperOrder, type PaperOrderLedgerSnapshot } from '../quant/paperOrderReconciliation.js';
import { prisma } from '../../lib/prisma.js';
import { DisabledBrokerAdapter } from '../quant/brokerAdapter.js';
import { certifyBrokerAdapter, type CertificationAdapter } from '../quant/brokerAdapterCertification.js';

export const quantPaperSafetyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);

  fastify.get('/api/quant/broker/certification', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async () => {
    const disabled = new DisabledBrokerAdapter();
    const adapter: CertificationAdapter = {
      id: disabled.id,
      mode: 'disabled',
      liveTradingEnabled: false,
      capabilities: {
        orderPreview: false, idempotentClientOrderIds: false,
        fillReconciliation: false, cancelOrders: false,
      },
      probe: async () => ({ status: 'disabled', reason: 'No provider is configured or approved.' }),
      placeOrder: async (..._args: unknown[]) => disabled.placeOrder(),
    };
    const report = await certifyBrokerAdapter(adapter);
    return {
      ...report,
      providerAdaptersRegistered: 0,
      note: 'No provider adapter or credential scope is configured. Certification is read-only and never places, previews, or cancels orders.',
    };
  });



  fastify.get<{ Querystring: { limit?: string } }>('/api/quant/paper/reconciliation', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return reply.code(400).send({ error: 'limit must be an integer between 1 and 500.' });
    }
    const rows = await fastify.prisma.$queryRawUnsafe<Array<{
      id: string; symbol: string; side: 'buy' | 'sell'; status: string;
      quantity: string; filled_quantity: string; remaining_quantity: string;
      average_fill_price: string | null; fill_price: string; fee: string; fills: unknown;
    }>>(
      `SELECT o.id, o.symbol, o.side, o.status, o.quantity::text,
              o.filled_quantity::text, o.remaining_quantity::text,
              o.average_fill_price::text, o.fill_price::text, o.fee::text,
              COALESCE(json_agg(json_build_object(
                'id', t.id, 'clientFillId', t.client_fill_id,
                'quantity', t.quantity::text, 'price', t.price::text, 'fee', t.fee::text
              ) ORDER BY t.created_at, t.id) FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS fills
       FROM quant_paper_orders o
       LEFT JOIN quant_paper_trades t ON t.order_id = o.id AND t.user_id = o.user_id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY MAX(o.created_at) DESC
       LIMIT $2`,
      request.authUser!.id, limit,
    );
    const reconciliations = rows.map((row) => {
      const raw = Array.isArray(row.fills) ? row.fills : [];
      const snapshot: PaperOrderLedgerSnapshot = {
        id: row.id, symbol: row.symbol, side: row.side, status: row.status,
        quantity: Number(row.quantity), storedFilledQuantity: Number(row.filled_quantity),
        storedRemainingQuantity: Number(row.remaining_quantity),
        storedAverageFillPrice: row.average_fill_price === null ? null : Number(row.average_fill_price),
        storedFillPrice: Number(row.fill_price), storedFee: Number(row.fee),
        fills: raw.map((value) => {
          const fill = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          return {
            id: String(fill.id ?? ''), clientFillId: String(fill.clientFillId ?? ''),
            quantity: Number(fill.quantity), price: Number(fill.price), fee: Number(fill.fee),
          };
        }),
      };
      return reconcilePaperOrder(snapshot);
    });
    const inconsistent = reconciliations.filter((item) => !item.consistent);
    return {
      scannedOrders: reconciliations.length,
      inconsistentOrders: inconsistent.length,
      consistentOrders: reconciliations.length - inconsistent.length,
      truncated: reconciliations.length === limit,
      reconciliations,
      sourceDataMutated: false,
      executionEnabled: false,
      mode: 'paper_ledger_audit_only',
    };
  });

  fastify.get('/api/quant/paper/risk/state', async (request) => {
    const userId = request.authUser!.id;
    const [policies, daily, portfolio] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT max_daily_loss::text, max_drawdown_pct::text, emergency_stop,
                emergency_stop_reason, emergency_stopped_at, trading_enabled
         FROM quant_paper_risk_policies WHERE user_id = $1`,
        userId,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT risk_date::text, starting_equity::text, current_equity::text, daily_loss::text
         FROM quant_paper_daily_risk_state
         WHERE user_id = $1 AND risk_date = CURRENT_DATE`,
        userId,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT peak_equity::text, current_equity::text, max_drawdown_pct::text
         FROM quant_paper_portfolio_risk_state WHERE user_id = $1`,
        userId,
      ),
    ]);
    const policy = policies[0];
    return {
      tradingEnabled: policy?.trading_enabled ?? true,
      emergencyStop: policy?.emergency_stop ?? false,
      emergencyStopReason: policy?.emergency_stop_reason ?? null,
      emergencyStoppedAt: policy?.emergency_stopped_at ?? null,
      maxDailyLoss: Number(policy?.max_daily_loss ?? 5000),
      maxDrawdownPct: Number(policy?.max_drawdown_pct ?? 10),
      dailyRisk: daily[0] ?? null,
      portfolioRisk: portfolio[0] ?? null,
      mode: 'paper_simulation_only',
      enforcement: 'evaluated_before_each_paper_fill_using_stored_simulated_fill_marks_not_live_quotes',
    };
  });

  fastify.put<{ Body: { maxDailyLoss: number; maxDrawdownPct: number } }>(
    '/api/quant/paper/risk/limits',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['maxDailyLoss', 'maxDrawdownPct'],
          properties: {
            maxDailyLoss: { type: 'number', minimum: 100, maximum: 50000 },
            maxDrawdownPct: { type: 'number', minimum: 1, maximum: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.authUser!.id;
      await prisma.$executeRawUnsafe(
        'INSERT INTO quant_paper_risk_policies (user_id, created_at, updated_at) VALUES ($1, NOW(), NOW()) ON CONFLICT (user_id) DO NOTHING',
        userId,
      );
      const current = await prisma.$queryRawUnsafe<Array<{ emergency_stop: boolean }>>(
        'SELECT emergency_stop FROM quant_paper_risk_policies WHERE user_id = $1',
        userId,
      );
      if (current[0]?.emergency_stop) {
        return reply.code(423).send({ error: 'Risk limits are locked while the emergency stop is active. Reset it explicitly first.' });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE quant_paper_risk_policies
         SET max_daily_loss = $2, max_drawdown_pct = $3, updated_at = NOW()
         WHERE user_id = $1`,
        userId, request.body.maxDailyLoss, request.body.maxDrawdownPct,
      );
      return {
        maxDailyLoss: request.body.maxDailyLoss,
        maxDrawdownPct: request.body.maxDrawdownPct,
        mode: 'paper_simulation_only',
      };
    },
  );

  fastify.post<{ Body: { reason?: string } }>(
    '/api/quant/paper/risk/emergency-stop',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { reason: { type: 'string', maxLength: 160 } },
        },
      },
    },
    async (request) => {
      const userId = request.authUser!.id;
      const reason = request.body.reason?.trim() || 'manual_emergency_stop';
      await prisma.$executeRawUnsafe(
        `INSERT INTO quant_paper_risk_policies
          (user_id, trading_enabled, emergency_stop, emergency_stop_reason,
           emergency_stopped_at, created_at, updated_at)
         VALUES ($1, FALSE, TRUE, $2, NOW(), NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           trading_enabled = FALSE, emergency_stop = TRUE,
           emergency_stop_reason = EXCLUDED.emergency_stop_reason,
           emergency_stopped_at = NOW(), updated_at = NOW()`,
        userId, reason,
      );
      return {
        emergencyStop: true,
        tradingEnabled: false,
        reason,
        mode: 'paper_simulation_only',
      };
    },
  );

  fastify.post<{ Body: { acknowledge: boolean } }>(
    '/api/quant/paper/risk/emergency-stop/reset',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['acknowledge'],
          properties: { acknowledge: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      if (request.body.acknowledge !== true) {
        return reply.code(400).send({ error: 'Explicit acknowledgement is required to reset the emergency stop.' });
      }
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE quant_paper_risk_policies
         SET emergency_stop = FALSE, emergency_stop_reason = NULL,
             emergency_stopped_at = NULL, trading_enabled = FALSE, updated_at = NOW()
         WHERE user_id = $1 AND emergency_stop = TRUE`,
        request.authUser!.id,
      );
      if (updated === 0) {
        return reply.code(409).send({ error: 'No active emergency stop exists for this account.' });
      }
      return {
        emergencyStop: false,
        tradingEnabled: false,
        message: 'Emergency stop reset. Paper trading remains disabled until separately re-enabled.',
        mode: 'paper_simulation_only',
      };
    },
  );
};
