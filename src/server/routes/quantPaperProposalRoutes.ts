import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';
import { prisma } from '../../lib/prisma.js';

const MAX_ORDER_NOTIONAL = 10000;
const MARKET_DATA_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

type SignalRow = {
  id: string;
  market_data_import_id: string;
  symbol: string;
  action: string;
  reference_price: string;
  last_bar_at: Date | string;
  is_stale: boolean;
  feed: string;
};

type ProposalRow = {
  id: string;
  signal_id: string;
  market_data_import_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  reference_price: string;
  notional: string;
  client_order_id: string;
  status: string;
  expires_at: Date | string;
  order_id: string | null;
  reason: string | null;
  created_at: Date | string;
  decided_at: Date | string | null;
  strategy?: string;
  signal_action?: string;
  source_bar_date?: string;
};

function isFresh(lastBarAt: Date | string, isStale: boolean): boolean {
  const timestamp = new Date(lastBarAt).getTime();
  const now = Date.now();
  return !isStale && Number.isFinite(timestamp) &&
    timestamp <= now && now - timestamp <= MARKET_DATA_MAX_AGE_MS;
}

function floorQuantity(value: number): number {
  return Math.floor(value * 1e8) / 1e8;
}

function serializeProposal(row: ProposalRow) {
  return {
    id: row.id,
    signalId: row.signal_id,
    marketDataImportId: row.market_data_import_id,
    symbol: row.symbol,
    side: row.side,
    quantity: Number(row.quantity),
    referencePrice: Number(row.reference_price),
    notional: Number(row.notional),
    status: row.status,
    expiresAt: row.expires_at,
    orderId: row.order_id,
    reason: row.reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    strategy: row.strategy ?? null,
    signalAction: row.signal_action ?? null,
    sourceBarDate: row.source_bar_date ?? null,
  };
}

export const quantPaperProposalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);

  fastify.get('/api/quant/paper/proposals', async (request) => {
    const userId = request.authUser!.id;
    await prisma.$executeRawUnsafe(
      `UPDATE quant_paper_order_proposals
       SET status = 'pending', decided_at = NULL, reason = 'confirmation_recovered_after_timeout'
       WHERE user_id = $1 AND status = 'confirming'
         AND decided_at < NOW() - INTERVAL '5 minutes'
         AND expires_at > NOW()`,
      userId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE quant_paper_order_proposals
       SET status = 'expired', decided_at = NOW(), reason = 'proposal_expired'
       WHERE user_id = $1 AND status IN ('pending', 'confirming') AND expires_at <= NOW()`,
      userId,
    );
    const rows = await prisma.$queryRawUnsafe<ProposalRow[]>(
      `SELECT p.id, p.signal_id, p.market_data_import_id, p.symbol, p.side,
              p.quantity::text, p.reference_price::text, p.notional::text,
              p.client_order_id, p.status, p.expires_at, p.order_id, p.reason,
              p.created_at, p.decided_at, s.strategy, s.action AS signal_action,
              to_char(i.last_bar_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS source_bar_date
       FROM quant_paper_order_proposals p
       INNER JOIN quant_strategy_signals s
         ON s.id = p.signal_id AND s.user_id = p.user_id
       INNER JOIN quant_market_data_imports i
         ON i.id = p.market_data_import_id AND i.user_id = p.user_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 30`,
      userId,
    );
    return {
      proposals: rows.map(serializeProposal),
      mode: 'paper_simulation_only',
      executionEnabled: false,
    };
  });

  fastify.post<{ Body: { signalId: string; notional: number } }>('/api/quant/paper/proposals', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['signalId', 'notional'],
        properties: {
          signalId: { type: 'string', minLength: 1, maxLength: 64 },
          notional: { type: 'number', minimum: 100, maximum: MAX_ORDER_NOTIONAL },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser!.id;
    const signals = await prisma.$queryRawUnsafe<SignalRow[]>(
      `SELECT s.id, s.market_data_import_id, i.symbol, s.action,
              s.reference_price::text, i.last_bar_at, i.is_stale, i.feed
       FROM quant_strategy_signals s
       INNER JOIN quant_market_data_imports i
         ON i.id = s.market_data_import_id AND i.user_id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2
       LIMIT 1`,
      request.body.signalId,
      userId,
    );
    const signal = signals[0];
    if (!signal) return reply.code(404).send({ error: 'Strategy signal was not found for this account.' });
    if (!isFresh(signal.last_bar_at, signal.is_stale)) {
      return reply.code(409).send({ error: 'The source market-data import is stale. Refresh the dataset and generate a new signal.' });
    }
    if (signal.action !== 'buy' && signal.action !== 'sell') {
      return reply.code(422).send({ error: 'Only validated buy or sell signals can become paper order proposals. Hold signals are not actionable.' });
    }

    const referencePrice = Number(signal.reference_price);
    if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
      return reply.code(422).send({ error: 'The signal does not contain a valid positive reference close.' });
    }
    const policies = await prisma.$queryRawUnsafe<Array<{
      max_order_notional: string;
      max_position_notional: string;
      max_gross_exposure: string;
      trading_enabled: boolean;
      emergency_stop: boolean;
    }>>(
      `SELECT max_order_notional::text, max_position_notional::text,
              max_gross_exposure::text, trading_enabled, emergency_stop
       FROM quant_paper_risk_policies WHERE user_id = $1`,
      userId,
    );
    const policy = policies[0] ?? {
      max_order_notional: '10000',
      max_position_notional: '25000',
      max_gross_exposure: '75000',
      trading_enabled: true,
      emergency_stop: false,
    };
    if (policy.emergency_stop) {
      return reply.code(423).send({ error: 'The emergency stop is active. Reset it explicitly before creating paper order proposals.' });
    }
    if (!policy.trading_enabled) {
      return reply.code(423).send({ error: 'Paper trading is paused by the account risk policy.' });
    }

    const requestedNotional = request.body.notional;
    if (requestedNotional > Math.min(Number(policy.max_order_notional), MAX_ORDER_NOTIONAL)) {
      return reply.code(409).send({ error: 'The requested proposal exceeds the configured per-order risk limit.' });
    }

    const [accounts, positions, exposures] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ cash_balance: string }>>(
        'SELECT cash_balance::text FROM quant_paper_accounts WHERE user_id = $1',
        userId,
      ),
      prisma.$queryRawUnsafe<Array<{ quantity: string; last_price: string }>>(
        'SELECT quantity::text, last_price::text FROM quant_paper_positions WHERE user_id = $1 AND symbol = $2',
        userId, signal.symbol,
      ),
      prisma.$queryRawUnsafe<Array<{ gross_exposure: string }>>(
        'SELECT COALESCE(SUM(quantity * last_price), 0)::text AS gross_exposure FROM quant_paper_positions WHERE user_id = $1 AND quantity > 0',
        userId,
      ),
    ]);
    const cash = Number(accounts[0]?.cash_balance ?? 100000);
    const heldQuantity = Number(positions[0]?.quantity ?? 0);
    const heldMarkPrice = Number(positions[0]?.last_price ?? referencePrice);
    const grossExposure = Number(exposures[0]?.gross_exposure ?? 0);
    let quantity = floorQuantity(requestedNotional / referencePrice);
    if (signal.action === 'sell') quantity = Math.min(quantity, heldQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return reply.code(409).send({
        error: signal.action === 'sell'
          ? 'There is no sellable paper position for this signal.'
          : 'The requested notional is too small to create a positive-quantity proposal.',
      });
    }

    const actualNotional = floorQuantity(quantity * referencePrice);
    const fee = actualNotional * 0.0005;
    if (signal.action === 'buy') {
      if (cash < actualNotional + fee) {
        return reply.code(409).send({ error: 'Available simulated cash is insufficient for this proposal and its estimated fee.' });
      }
      const currentSymbolExposure = heldQuantity * heldMarkPrice;
      if (currentSymbolExposure + actualNotional > Number(policy.max_position_notional)) {
        return reply.code(409).send({ error: 'This proposal would exceed the configured single-position exposure limit.' });
      }
      if (grossExposure + actualNotional > Number(policy.max_gross_exposure)) {
        return reply.code(409).send({ error: 'This proposal would exceed the configured gross portfolio exposure limit.' });
      }
    }

    const clientOrderId = `qp-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO quant_paper_order_proposals
        (user_id, signal_id, market_data_import_id, symbol, side, quantity,
         reference_price, notional, client_order_id, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, NOW())
       RETURNING id`,
      userId,
      signal.id,
      signal.market_data_import_id,
      signal.symbol,
      signal.action,
      quantity,
      referencePrice,
      actualNotional,
      clientOrderId,
      expiresAt,
    );
    return reply.code(201).send({
      proposal: {
        id: rows[0].id,
        signalId: signal.id,
        symbol: signal.symbol,
        side: signal.action,
        quantity,
        referencePrice,
        notional: actualNotional,
        estimatedFee: fee,
        status: 'pending',
        expiresAt: expiresAt.toISOString(),
        sourceFeed: signal.feed,
        clientOrderId,
      },
      mode: 'paper_simulation_only',
      orderPlaced: false,
      message: 'Paper order proposal saved. No order has been placed; explicit confirmation is required.',
    });
  });

  fastify.post<{ Params: { proposalId: string } }>(
    '/api/quant/paper/proposals/:proposalId/confirm',
    async (request, reply) => {
      const userId = request.authUser!.id;
      await prisma.$executeRawUnsafe(
        `UPDATE quant_paper_order_proposals
         SET status = 'pending', decided_at = NULL, reason = 'confirmation_recovered_after_timeout'
         WHERE user_id = $1 AND status = 'confirming'
           AND decided_at < NOW() - INTERVAL '5 minutes'
           AND expires_at > NOW()`,
        userId,
      );
      const claimed = await prisma.$queryRawUnsafe<ProposalRow[]>(
        `UPDATE quant_paper_order_proposals
         SET status = 'confirming', decided_at = NOW(), reason = NULL
         WHERE id = $1 AND user_id = $2 AND status = 'pending' AND expires_at > NOW()
         RETURNING id, signal_id, market_data_import_id, symbol, side,
                   quantity::text, reference_price::text, notional::text,
                   client_order_id, status, expires_at, order_id, reason,
                   created_at, decided_at`,
        request.params.proposalId,
        userId,
      );
      const proposal = claimed[0];
      if (!proposal) {
        const existing = await prisma.$queryRawUnsafe<Array<{ status: string; order_id: string | null }>>(
          'SELECT status, order_id FROM quant_paper_order_proposals WHERE id = $1 AND user_id = $2 LIMIT 1',
          request.params.proposalId,
          userId,
        );
        if (!existing[0]) return reply.code(404).send({ error: 'Paper order proposal was not found for this account.' });
        return reply.code(409).send({
          error: existing[0].status === 'expired'
            ? 'This paper order proposal has expired.'
            : 'This proposal is not pending confirmation.',
          status: existing[0].status,
          orderId: existing[0].order_id,
        });
      }

      const sourceRows = await prisma.$queryRawUnsafe<Array<{
        last_bar_at: Date | string;
        is_stale: boolean;
      }>>(
        `SELECT last_bar_at, is_stale FROM quant_market_data_imports
         WHERE id = $1 AND user_id = $2 LIMIT 1`,
        proposal.market_data_import_id,
        userId,
      );
      if (!sourceRows[0] || !isFresh(sourceRows[0].last_bar_at, sourceRows[0].is_stale)) {
        await prisma.$executeRawUnsafe(
          `UPDATE quant_paper_order_proposals
           SET status = 'rejected', reason = 'source_market_data_stale', decided_at = NOW()
           WHERE id = $1 AND user_id = $2 AND status = 'confirming'`,
          proposal.id, userId,
        );
        return reply.code(409).send({ error: 'The proposal source data is stale. Create a new proposal from a fresh signal.' });
      }

      const orderResponse = await fastify.inject({
        method: 'POST',
        url: '/api/quant/paper/orders',
        headers: request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {},
        payload: {
          symbol: proposal.symbol,
          side: proposal.side,
          quantity: Number(proposal.quantity),
          reference_price: Number(proposal.reference_price),
          client_order_id: proposal.client_order_id,
        },
      });
      const orderResult = orderResponse.json() as {
        error?: string;
        orderId?: string;
        duplicate?: boolean;
        status?: string;
      };
      if (orderResponse.statusCode < 200 || orderResponse.statusCode >= 300 || !orderResult.orderId) {
        await prisma.$executeRawUnsafe(
          `UPDATE quant_paper_order_proposals
           SET status = CASE WHEN expires_at <= NOW() THEN 'expired' ELSE 'pending' END,
               reason = $3, decided_at = NULL
           WHERE id = $1 AND user_id = $2 AND status = 'confirming'`,
          proposal.id,
          userId,
          orderResult.error ?? 'paper_order_confirmation_failed',
        );
        return reply.code(orderResponse.statusCode >= 400 ? orderResponse.statusCode : 502).send({
          error: orderResult.error || 'Paper order could not be confirmed.',
          proposalId: proposal.id,
          orderPlaced: false,
        });
      }

      await prisma.$executeRawUnsafe(
        `UPDATE quant_paper_order_proposals
         SET status = 'confirmed', order_id = $3, reason = NULL, decided_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'confirming'`,
        proposal.id,
        userId,
        orderResult.orderId,
      );
      return reply.code(orderResult.duplicate ? 200 : 201).send({
        proposalId: proposal.id,
        status: 'confirmed',
        order: orderResult,
        mode: 'paper_simulation_only',
        brokerConnected: false,
      });
    },
  );

  fastify.post<{ Params: { proposalId: string }; Body: { reason?: string } }>(
    '/api/quant/paper/proposals/:proposalId/reject',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { reason: { type: 'string', maxLength: 160 } },
        },
      },
    },
    async (request, reply) => {
      const reason = request.body.reason?.trim() || 'rejected_by_user';
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE quant_paper_order_proposals
         SET status = 'rejected', reason = $3, decided_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
        request.params.proposalId,
        request.authUser!.id,
        reason,
      );
      if (updated === 0) {
        return reply.code(409).send({ error: 'Proposal is no longer pending and cannot be rejected.' });
      }
      return { proposalId: request.params.proposalId, status: 'rejected', reason };
    },
  );
};
