import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';
import {
  reconcileDailyBarsWithMinuteEvents,
  type ReconciliationBar,
  type StreamBarEvent,
} from '../quant/marketDataReconciliation.js';

const MAX_STREAM_EVENTS = 100_000;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export const quantReconciliationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);

  fastify.get<{ Querystring: { importId?: string } }>(
    '/api/quant/market-data/reconcile',
    async (request, reply) => {
      const importId = request.query.importId?.trim();
      if (!importId || importId.length > 64) {
        return reply.code(400).send({ error: 'A valid market-data import ID is required.' });
      }

      const imports = await fastify.prisma.$queryRawUnsafe<Array<{
        id: string;
        symbol: string;
        provider: string;
        feed: string;
        timeframe: string;
        first_bar_at: Date | string;
        last_bar_at: Date | string;
        bars: unknown;
      }>>(
        `SELECT id, symbol, provider, feed, timeframe, first_bar_at, last_bar_at, bars
         FROM quant_market_data_imports
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        importId,
        request.authUser!.id,
      );
      const imported = imports[0];
      if (!imported) {
        return reply.code(404).send({ error: 'Market-data import not found for this account.' });
      }
      if (imported.timeframe !== '1Day') {
        return reply.code(409).send({ error: 'Reconciliation currently requires a 1Day historical import.' });
      }
      if (!Array.isArray(imported.bars) || imported.bars.length === 0) {
        return reply.code(422).send({ error: 'The selected historical import contains no usable bars.' });
      }
      if (!['alpaca'].includes(imported.provider) || !['iex', 'sip', 'delayed_sip'].includes(imported.feed)) {
        return reply.code(409).send({ error: 'The historical provider/feed cannot be reconciled with the stored stream events.' });
      }

      const eventRows = await fastify.prisma.$queryRawUnsafe<Array<{
        id: string;
        event_timestamp: Date;
        bar: unknown;
      }>>(
        `SELECT id::text, event_timestamp, bar
         FROM quant_market_data_events
         WHERE user_id = $1
           AND symbol = $2
           AND provider = $3
           AND feed = $4
           AND timeframe = '1Min'
           AND event_timestamp >= $5
           AND event_timestamp <= $6
         ORDER BY event_timestamp ASC, id ASC
         LIMIT $7`,
        request.authUser!.id,
        imported.symbol,
        imported.provider,
        imported.feed,
        asDate(imported.first_bar_at),
        asDate(imported.last_bar_at),
        MAX_STREAM_EVENTS + 1,
      );
      const eventsTruncated = eventRows.length > MAX_STREAM_EVENTS;
      const streamEvents: StreamBarEvent[] = eventRows.slice(0, MAX_STREAM_EVENTS).map((event) => ({
        id: event.id,
        eventTimestamp: event.event_timestamp,
        bar: event.bar,
      }));
      const historicalBars = imported.bars as ReconciliationBar[];
      let reconciliations: ReturnType<typeof reconcileDailyBarsWithMinuteEvents>;
      try {
        reconciliations = reconcileDailyBarsWithMinuteEvents(historicalBars, streamEvents, { eventsTruncated });
      } catch {
        return reply.code(422).send({ error: 'Historical or streamed bars failed reconciliation validation.' });
      }

      const summary = reconciliations.reduce((result, item) => {
        result[item.status] += 1;
        return result;
      }, {
        no_stream_data: 0,
        incomplete_stream_coverage: 0,
        candidate_match: 0,
        candidate_mismatch: 0,
      });
      return {
        importId: imported.id,
        symbol: imported.symbol,
        provider: imported.provider,
        feed: imported.feed,
        historicalTimeframe: imported.timeframe,
        streamTimeframe: '1Min',
        sessionTimezone: 'America/New_York',
        eventsTruncated,
        summary,
        reconciliations,
        authoritativeSource: 'historical_import',
        sourceDataMutated: false,
        executionEnabled: false,
      };
    },
  );
};
