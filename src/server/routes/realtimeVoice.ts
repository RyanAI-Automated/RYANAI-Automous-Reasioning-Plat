import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { requireUser } from './auth.js';
import { ownerCommunicationInstruction } from '../../shared/ryanIdentity.js';

const TICKET_TTL_SECONDS = 30;
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_MINUTE = 120;
const REALTIME_MODEL = process.env.RYANAI_REALTIME_MODEL?.trim() || 'gpt-4o-realtime-preview-2024-10-01';

interface VoiceTicket {
  userId: string;
  isOwner: boolean;
}

interface RedisTicketClient {
  set(key: string, value: string, expiry: 'EX', seconds: number, mode: 'NX'): Promise<string | null>;
  getdel(key: string): Promise<string | null>;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Native clients are protected by the single-use ticket.
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    configured.push(
      'http://localhost:1420',
      'http://127.0.0.1:1420',
      'http://localhost:9090',
      'http://127.0.0.1:9090',
    );
  }
  return configured.includes(origin);
}

export const realtimeVoiceRoutes: FastifyPluginAsync = async (fastify) => {
  const redis = fastify.redis as unknown as RedisTicketClient;

  fastify.post('/api/v1/realtime/voice-ticket', {
    preHandler: requireUser,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = request.authUser;
    if (!user?.id) return reply.code(401).send({ error: 'Sign in to start a voice session.' });

    const ticket = randomBytes(32).toString('base64url');
    const value: VoiceTicket = { userId: user.id, isOwner: user.isOwner };
    const stored = await redis.set(
      `ryanai:realtime-voice:${ticket}`,
      JSON.stringify(value),
      'EX',
      TICKET_TTL_SECONDS,
      'NX',
    );
    if (stored !== 'OK') {
      return reply.code(503).send({ error: 'Could not create a voice session. Please retry.' });
    }
    return reply.code(201).send({ ticket, expiresIn: TICKET_TTL_SECONDS });
  });

  type VoiceRequest = FastifyRequest<{ Querystring: { ticket?: string } }> & {
    voiceIdentity?: VoiceTicket;
  };

  fastify.get<{ Querystring: { ticket?: string } }>('/api/v1/realtime/voice', {
    websocket: true,
    preValidation: async (request, reply) => {
      const origin = request.headers.origin;
      if (!isAllowedOrigin(origin)) {
        return reply.code(403).send({ error: 'Origin is not allowed.' });
      }
      const ticket = request.query.ticket;
      if (!ticket || ticket.length > 128) {
        return reply.code(401).send({ error: 'A valid voice ticket is required.' });
      }
      const serialized = await redis.getdel(`ryanai:realtime-voice:${ticket}`);
      if (!serialized) {
        return reply.code(401).send({ error: 'Voice ticket is invalid, expired, or already used.' });
      }
      try {
        const identity = JSON.parse(serialized) as VoiceTicket;
        if (!identity.userId || typeof identity.isOwner !== 'boolean') {
          return reply.code(401).send({ error: 'Invalid voice session.' });
        }
        (request as VoiceRequest).voiceIdentity = identity;
      } catch {
        return reply.code(401).send({ error: 'Invalid voice session.' });
      }
    },
  }, (socket, request) => {
    const identity = (request as VoiceRequest).voiceIdentity;
    if (!identity) {
      socket.close(1008, 'Authenticated voice session required');
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      socket.send(JSON.stringify({ type: 'error', error: 'Realtime voice is not configured.' }));
      socket.close(1011, 'Realtime voice unavailable');
      return;
    }

    const upstream = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
        maxPayload: MAX_CLIENT_MESSAGE_BYTES,
      },
    );

    let messageWindowStarted = Date.now();
    let messageCount = 0;
    let closed = false;
    let upstreamTimeout: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => closeBoth(1011, 'Realtime upstream connection timed out'),
      10_000,
    );
    const closeBoth = (code = 1000, reason = 'Voice session ended') => {
      if (closed) return;
      closed = true;
      clearTimeout(upstreamTimeout);
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
      if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    };

    upstream.on('open', () => {
      clearTimeout(upstreamTimeout);
      upstreamTimeout = undefined;
      if (socket.readyState !== WebSocket.OPEN) {
        closeBoth();
        return;
      }
      const instructions = identity.isOwner
        ? ownerCommunicationInstruction()
        : 'You are RyanAI, a helpful voice assistant. Respect the signed-in user and their configured language preference. Do not claim to perform actions unless a connected tool confirms completion.';
      upstream.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions,
          voice: process.env.RYANAI_REALTIME_VOICE?.trim() || 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      }));
      fastify.log.info({ userId: identity.userId }, 'Authenticated RyanAI realtime voice session connected');
    });

    upstream.on('message', (data: WebSocket.RawData) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data.toString());
    });

    upstream.on('error', (error: Error) => {
      fastify.log.warn({ error, userId: identity.userId }, 'Realtime voice upstream connection failed');
      closeBoth(1011, 'Realtime voice upstream unavailable');
    });
    upstream.on('close', () => closeBoth());

    socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      const message = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data);
      if (isBinary || message.length > MAX_CLIENT_MESSAGE_BYTES) {
        closeBoth(1009, 'Only bounded JSON Realtime events are accepted');
        return;
      }
      const now = Date.now();
      if (now - messageWindowStarted >= 60_000) {
        messageWindowStarted = now;
        messageCount = 0;
      }
      messageCount += 1;
      if (messageCount > MAX_MESSAGES_PER_MINUTE) {
        closeBoth(1008, 'Voice event rate limit exceeded');
        return;
      }
      if (upstream.readyState !== WebSocket.OPEN) return;
      const payload = message.toString('utf8');
      try {
        const event = JSON.parse(payload) as {
          type?: unknown;
          audio?: unknown;
          response?: unknown;
          item?: { type?: unknown; role?: unknown; content?: Array<{ type?: unknown }> };
        };
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
          closeBoth(1003, 'Invalid Realtime event');
          return;
        }

        // Session instructions and tools are server-owned. Only permit user-input
        // and response-control events; never let a browser replace system policy.
        const allowedTypes = new Set([
          'input_audio_buffer.append',
          'input_audio_buffer.commit',
          'input_audio_buffer.clear',
          'response.create',
          'response.cancel',
          'conversation.item.create',
        ]);
        if (!allowedTypes.has(event.type)) {
          closeBoth(1008, 'Realtime event type is not permitted');
          return;
        }
        if (event.type === 'input_audio_buffer.append' &&
          (typeof event.audio !== 'string' || event.audio.length > 48_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.audio))) {
          closeBoth(1008, 'Invalid or oversized audio payload');
          return;
        }
        if (event.type === 'response.create' && event.response !== undefined) {
          closeBoth(1008, 'Response configuration is controlled by the server');
          return;
        }
        if (event.type === 'conversation.item.create') {
          const item = event.item;
          if (
            item?.type !== 'message' ||
            item.role !== 'user' ||
            !Array.isArray(item.content) ||
            item.content.length === 0 ||
            item.content.some((part) => !part || !['input_text', 'input_audio'].includes(String(part.type)))
          ) {
            closeBoth(1008, 'Only user conversation input is permitted');
            return;
          }
        }
        upstream.send(payload);
      } catch {
        closeBoth(1003, 'Realtime events must be valid JSON');
      }
    });

    socket.on('close', () => closeBoth());
    socket.on('error', (error: Error) => {
      fastify.log.debug({ error, userId: identity.userId }, 'Realtime voice client socket closed with error');
      closeBoth(1011);
    });
  });
};
