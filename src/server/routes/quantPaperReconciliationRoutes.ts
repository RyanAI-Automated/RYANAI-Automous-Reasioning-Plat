import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';
import { reconcilePaperOrder, type PaperOrderLedgerSnapshot } from '../quant/paperOrderReconciliation.js';

type PaperOrderRow = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  quantity: string;
  filled_quantity: string;
  remaining_quantity: string;
  average_fill_price: string | null;
  fill_price: string;
  fee: string;
  fills: unknown;
};

export const quantPaperReconciliationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);

  fastify.get<{ Querystring: { limit?: string } }>('/api/quant/paper/reconciliation', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return reply.code(400).send({ error: 'limit must be an integer between 1 and 500.' });
    }
    const rows = await fastify.prisma.$queryRawUnsafe<PaperOrderRow[]>(
      `SELECT o.id, o.symbol, o.side, o.status, o.quantity::text,
              o.filled_quantity::text, o.remaining_quantity::text,
              o.average_fill_price::text, o.fill_price::text, o.fee::text,
              COALESCE(
                json_agg(json_build_object(
                  'id', t.id,
                  'clientFillId', t.client_fill_id,
                  'quantity', t.quantity::text,
                  'price', t.price::text,
                  'fee', t.fee::text
                ) ORDER BY t.created_at, t.id) FILTER (WHERE t.id IS NOT NULL),
                '[]'::json
              ) AS fills
       FROM quant_paper_orders o
       LEFT JOIN quant_paper_trades t
         ON t.order_id = o.id AND t.user_id = o.user_id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY MAX(o.created_at) DESC
       LIMIT $2`,
      request.authUser!.id,
      limit,
    );

    const reconciliations = rows.map((row) => {
      const rawFills = Array.isArray(row.fills) ? row.fills : [];
      const snapshot: PaperOrderLedgerSnapshot = {
        id: row.id,
        symbol: row.symbol,
        side: row.side,
        status: row.status,
        quantity: Number(row.quantity),
        storedFilledQuantity: Number(row.filled_quantity),
        storedRemainingQuantity: Number(row.remaining_quantity),
        storedAverageFillPrice: row.average_fill_price === null ? null : Number(row.average_fill_price),
        storedFillPrice: Number(row.fill_price),
        storedFee: Number(row.fee),
        fills: rawFills.map((value) => {
          const fill = value as Record<string, unknown>;
          return {
            id: String(fill.id ?? ''),
            clientFillId: String(fill.clientFillId ?? ''),
            quantity: Number(fill.quantity),
            price: Number(fill.price),
            fee: Number(fill.fee),
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
};
