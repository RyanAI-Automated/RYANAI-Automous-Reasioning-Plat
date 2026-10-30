import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { requireUser } from './auth.js';
import { getOwnerResponseLanguage, ownerCommunicationInstruction } from '../../shared/ryanIdentity.js';
import { DEFAULT_LANGUAGE, isRyanLanguage, languageInstruction } from '../../shared/languages.js';

const TICKET_TTL_SECONDS = 30;
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_MINUTE = 1800;
const REALTIME_MODEL = process.env.RYANAI_REALTIME_MODEL?.trim() || 'gpt-live-1';

interface VoiceTicket {
  userId: string;
  isOwner: boolean;
  language: string;
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

  fastify.post<{ Body: { language?: string } }>('/api/v1/realtime/voice-ticket', {
    preHandler: requireUser,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = request.authUser;
    if (!user?.id) return reply.code(401).send({ error: 'Sign in to start a voice session.' });

    const requestedLanguage = request.body?.language;
    const language = user.isOwner
      ? getOwnerResponseLanguage()
      : requestedLanguage && isRyanLanguage(requestedLanguage)
        ? requestedLanguage
        : DEFAULT_LANGUAGE;
    const ticket = randomBytes(32).toString('base64url');
    const value: VoiceTicket = { userId: user.id, isOwner: user.isOwner, language };
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
        if (!identity.userId || typeof identity.isOwner !== 'boolean' || !isRyanLanguage(identity.language)) {
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
      'wss://api.openai.com/v1/live/sessions',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        maxPayload: MAX_CLIENT_MESSAGE_BYTES,
      },
    );

    let messageWindowStarted = Date.now();
    let messageCount = 0;
    let sessionStarted = false;
    let closed = false;
    let upstreamTimeout: ReturnType<typeof setTimeout> | undefined;
    let finalizeTimeout: ReturnType<typeof setTimeout> | undefined;
    const closeBoth = (code = 1000, reason = 'Voice session ended') => {
      if (closed) return;
      closed = true;
      clearTimeout(upstreamTimeout);
      clearTimeout(finalizeTimeout);
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
      if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    };
    upstreamTimeout = setTimeout(
      () => closeBoth(1011, 'Live upstream connection timed out'),
      10_000,
    );

    upstream.on('open', () => {
      clearTimeout(upstreamTimeout);
      upstreamTimeout = undefined;
      if (socket.readyState !== WebSocket.OPEN) {
        closeBoth();
        return;
      }
      const instructions = identity.isOwner
        ? ownerCommunicationInstruction()
        : [
            'You are RyanAI, a helpful voice assistant for the signed-in user.',
            languageInstruction(identity.language),
            'Do not claim to perform actions unless a connected tool confirms completion.',
          ].join(' ');
      upstream.send(JSON.stringify({
        type: 'session.start',
        event_id: randomBytes(12).toString('hex'),
        session: {
          model: REALTIME_MODEL,
          instructions,
          audio: {
            format: { type: 'audio/pcm', rate: 24_000 },
            output: {
              voice: process.env.RYANAI_REALTIME_VOICE?.trim() || 'marin',
            },
          },
        },
      }));
    });

    upstream.on('message', (data: WebSocket.RawData) => {
      const payload = data.toString();
      try {
        const event = JSON.parse(payload) as { type?: string; session?: { id?: string }; usage?: unknown };
        if (event.type === 'session.started') {
          sessionStarted = true;
          fastify.log.info(
            { userId: identity.userId, sessionId: event.session?.id },
            'Authenticated RyanAI Live voice session started',
          );
        } else if (event.type === 'session.closed') {
          fastify.log.info({ userId: identity.userId, usage: event.usage }, 'RyanAI Live voice session finalized');
          closeBoth();
          return;
        }
      } catch {
        fastify.log.warn({ userId: identity.userId }, 'Received an invalid event from the Live voice provider');
        closeBoth(1011, 'Invalid Live provider event');
        return;
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
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
      if (upstream.readyState !== WebSocket.OPEN || !sessionStarted) return;
      const payload = message.toString('utf8');
      try {
        const event = JSON.parse(payload) as { type?: unknown; audio?: unknown };
        if (!event || typeof event !== 'object' || event.type !== 'session.input_audio.append') {
          closeBoth(1008, 'Only PCM16 user audio events are permitted');
          return;
        }
        if (
          typeof event.audio !== 'string' ||
          event.audio.length === 0 ||
          event.audio.length > 48_000 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(event.audio)
        ) {
          closeBoth(1008, 'Invalid or oversized audio payload');
          return;
        }
        const audioBytes = Buffer.from(event.audio, 'base64');
        if (audioBytes.length === 0 || audioBytes.length % 2 !== 0 || audioBytes.toString('base64') !== event.audio) {
          closeBoth(1008, 'Audio must be valid mono PCM16 data');
          return;
        }
        upstream.send(payload);
      } catch {
        closeBoth(1003, 'Live voice events must be valid JSON');
      }
    });

    socket.on('close', () => {
      if (sessionStarted && upstream.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ type: 'session.close' }));
        finalizeTimeout = setTimeout(() => closeBoth(), 15_000);
      } else {
        closeBoth();
      }
    });
    socket.on('error', (error: Error) => {
      fastify.log.debug({ error, userId: identity.userId }, 'Realtime voice client socket closed with error');
      closeBoth(1011);
    });
  });
};
