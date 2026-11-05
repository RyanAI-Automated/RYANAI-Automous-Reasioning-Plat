import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { requireUser } from './auth.js';
import { createAlpacaStockStream, type MarketDataSocket, type StreamedMarketBar } from '../quant/marketDataStream.js';
import { createMarketDataFanout, createMarketDataStreamSupervisor, type StreamSupervisorState } from '../quant/marketDataSupervisor.js';

const TICKET_TTL_SECONDS = 30;
const MAX_SYMBOLS_PER_SESSION = 5;
const MAX_ACTIVE_SESSIONS = 25;
const MAX_SESSION_MS = 60 * 60 * 1000;

type StreamFeed = StreamedMarketBar['feed'];
type StreamTicket = { userId: string; symbols: string[]; feed: StreamFeed };
type RedisTicketClient = {
  set(key: string, value: string, expiry: 'EX', seconds: number, mode: 'NX'): Promise<string | null>;
  getdel(key: string): Promise<string | null>;
};
type StreamRequest = { symbols: string[]; feed: StreamFeed };

type StreamSocketRequest = FastifyRequest<{ Querystring: { ticket?: string } }> & {
  quantStreamIdentity?: StreamTicket;
};

let activeSessions = 0;

export function normalizeQuantStreamRequest(value: unknown): StreamRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A stream request is required.');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['symbols', 'feed'].includes(key))) {
    throw new Error('Only symbols and feed are accepted.');
  }
  if (!Array.isArray(body.symbols) || body.symbols.length < 1 || body.symbols.length > MAX_SYMBOLS_PER_SESSION) {
    throw new Error(`Choose between 1 and ${MAX_SYMBOLS_PER_SESSION} symbols.`);
  }
  const symbols = body.symbols.map((value) => {
    if (typeof value !== 'string') throw new Error('Every symbol must be text.');
    const symbol = value.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,15}$/.test(symbol)) throw new Error('A market-data symbol is invalid.');
    return symbol;
  });
  if (new Set(symbols).size !== symbols.length) throw new Error('Duplicate symbols are not allowed.');
  const feed = body.feed ?? 'iex';
  if (feed !== 'iex' && feed !== 'sip' && feed !== 'delayed_sip') {
    throw new Error('Unsupported market-data feed.');
  }
  return { symbols, feed };
}

function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const configured = (process.env.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    configured.push('http://localhost:1420', 'http://127.0.0.1:1420', 'http://localhost:9090', 'http://127.0.0.1:9090');
  }
  return configured.includes(origin);
}

function safeState(state: StreamSupervisorState): Record<string, unknown> {
  if (state.status === 'backoff') {
    return { status: state.status, attempt: state.attempt, retryInMs: state.retryInMs };
  }
  return state;
}

export const quantStreamingRoutes: FastifyPluginAsync = async (fastify) => {
  const redis = fastify.redis as unknown as RedisTicketClient;

  fastify.post<{ Body: unknown }>('/api/quant/stream-ticket', {
    preHandler: requireUser,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    let normalized: StreamRequest;
    try {
      normalized = normalizeQuantStreamRequest(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid stream request.' });
    }
    if (!process.env.ALPACA_API_KEY?.trim() || !process.env.ALPACA_API_SECRET?.trim()) {
      return reply.code(503).send({ error: 'Authenticated market-data streaming is not configured.' });
    }
    const ticket = randomBytes(32).toString('base64url');
    const identity: StreamTicket = {
      userId: request.authUser!.id,
      symbols: normalized.symbols,
      feed: normalized.feed,
    };
    const stored = await redis.set(
      `ryanai:quant-stream:${ticket}`,
      JSON.stringify(identity),
      'EX',
      TICKET_TTL_SECONDS,
      'NX',
    );
    if (stored !== 'OK') {
      return reply.code(503).send({ error: 'Could not create a market-data stream ticket.' });
    }
    return reply.code(201).send({ ticket, expiresIn: TICKET_TTL_SECONDS, symbols: identity.symbols, feed: identity.feed });
  });

  fastify.get<{ Querystring: { ticket?: string } }>('/api/quant/stream', {
    websocket: true,
    preValidation: async (request, reply) => {
      if (!allowedOrigin(request.headers.origin)) {
        return reply.code(403).send({ error: 'Origin is not allowed.' });
      }
      const ticket = request.query.ticket;
      if (!ticket || ticket.length > 128) {
        return reply.code(401).send({ error: 'A valid market-data stream ticket is required.' });
      }
      const serialized = await redis.getdel(`ryanai:quant-stream:${ticket}`);
      if (!serialized) {
        return reply.code(401).send({ error: 'Market-data stream ticket is invalid, expired, or already used.' });
      }
      try {
        const identity = JSON.parse(serialized) as StreamTicket;
        const normalized = normalizeQuantStreamRequest(identity);
        if (typeof identity.userId !== 'string' || !identity.userId || normalized.symbols.length !== identity.symbols.length) {
          return reply.code(401).send({ error: 'Invalid market-data stream session.' });
        }
        (request as StreamSocketRequest).quantStreamIdentity = { userId: identity.userId, ...normalized };
      } catch {
        return reply.code(401).send({ error: 'Invalid market-data stream session.' });
      }
    },
  }, (socket, request) => {
    const identity = (request as StreamSocketRequest).quantStreamIdentity;
    if (!identity || activeSessions >= MAX_ACTIVE_SESSIONS) {
      socket.close(1013, 'Market-data stream capacity unavailable');
      return;
    }
    const apiKey = process.env.ALPACA_API_KEY?.trim();
    const apiSecret = process.env.ALPACA_API_SECRET?.trim();
    if (!apiKey || !apiSecret) {
      socket.close(1011, 'Market-data provider unavailable');
      return;
    }

    activeSessions += 1;
    const fanout = createMarketDataFanout({
      maxSubscribers: MAX_SYMBOLS_PER_SESSION,
      maxSymbols: MAX_SYMBOLS_PER_SESSION,
      maxAgeMs: 120_000,
    });
    const subscriptions = identity.symbols.map((symbol) => fanout.subscribe(symbol, (bar) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'bar', data: bar }));
      }
    }));
    const supervisor = createMarketDataStreamSupervisor({
      createStream: (handlers) => createAlpacaStockStream({
        apiKey,
        apiSecret,
        symbols: identity.symbols,
        feed: identity.feed,
        socketFactory: (url) => new WebSocket(url) as unknown as MarketDataSocket,
        onBar: handlers.onBar,
        onError: handlers.onError,
      }),
      onBar: (bar) => fanout.publish(bar),
      onState: (state) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'status', data: safeState(state) }));
      },
      maxAttempts: 5,
    });

    let closed = false;
    const sessionTimer = setTimeout(() => socket.close(1000, 'Market-data session reached its maximum duration'), MAX_SESSION_MS);
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(sessionTimer);
      supervisor.stop();
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      fanout.close();
      activeSessions = Math.max(0, activeSessions - 1);
    };
    socket.on('message', () => socket.close(1008, 'Market-data stream is server-to-client only'));
    socket.on('close', close);
    socket.on('error', close);
    socket.send(JSON.stringify({
      type: 'ready',
      data: { symbols: identity.symbols, feed: identity.feed, persistence: 'not_enabled', distribution: 'process_local' },
    }));
    supervisor.start();
  });
};
