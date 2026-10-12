// src/api/websocket.ts - Real-time WebSocket bridge
import { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAdmin } from '../server/routes/auth.js';
import { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import {
  WebSocketMessage,
  AuthContext,
  ReasoningRequest,
} from '../shared/types.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('websocket');

interface ConnectionContext {
  id: string;
  ws: WebSocket;
  auth?: AuthContext;
  subscriptions: Set<string>;
  connectedAt: number;
}

const connections = new Map<string, ConnectionContext>();
const channels = new Map<string, Set<string>>();

/**
 * Register the admin-only /ws bridge with 10 upgrade attempts per minute.
 * Each connection expires after five minutes and closes after more than 60 messages
 * in a one-minute window. Closing removes its subscriptions and connection state.
 */
export async function registerWebSocketRoutes(fastify: FastifyInstance) {
  logger.info('Registering WebSocket routes');

  // Upgrade HTTP to WebSocket
  fastify.get(
    '/ws',
    {
      websocket: true,
      // Explicit upgrade limit applies before Supabase verification, even when
      // this route is registered outside the launcher's global authentication.
      config: { rateLimit: false },
      onRequest: fastify.rateLimit({ max: 10, timeWindow: '1 minute' }),
      preValidation: requireAdmin,
    },
    async (socket, request: FastifyRequest) => {
      const connId = uuid();
      const auth = extractAuth(request);

      const context: ConnectionContext = {
        id: connId,
        ws: socket as WebSocket,
        auth,
        subscriptions: new Set(),
        connectedAt: Date.now(),
      };

      // Bound the connection lifetime; reconnecting requires fresh verification.
      const expiry = setTimeout(
        () => socket.close(1008, 'Reauthenticate'),
        5 * 60 * 1000,
      );
      connections.set(connId, context);
      logger.info({ connId, auth: auth?.email }, 'WebSocket connected');

      let windowStartedAt = Date.now();
      let messageCount = 0;
      let rateLimited = false;
      socket.on('message', async (data: Buffer) => {
        if (rateLimited) return;
        const now = Date.now();
        if (now - windowStartedAt >= 60_000) {
          windowStartedAt = now;
          messageCount = 0;
        }
        messageCount += 1;
        if (messageCount > 60) {
          rateLimited = true;
          sendError(socket, 'RATE_LIMITED', 'Too many messages');
          socket.close(1008, 'Message rate limit exceeded');
          return;
        }
        try {
          const message = JSON.parse(data.toString()) as WebSocketMessage;
          await handleMessage(context, message);
        } catch (err) {
          logger.error({ err, connId }, 'Message handling error');
          sendError(socket, 'PARSE_ERROR', 'Invalid message format');
        }
      });

      socket.on('close', () => {
        clearTimeout(expiry);
        connections.delete(connId);
        context.subscriptions.forEach((channel) => {
          const channelSubs = channels.get(channel);
          if (channelSubs) {
            channelSubs.delete(connId);
            if (channelSubs.size === 0) channels.delete(channel);
          }
        });
        logger.info({ connId }, 'WebSocket disconnected');
      });

      socket.on('error', (err) => {
        logger.error({ err, connId }, 'WebSocket error');
      });
    },
  );
}

/**
 * Reply to authentication, reasoning, and subscription requests or stream acknowledgments.
 * Dispatch failures become HANDLER_ERROR responses; sending the response can still throw.
 */
async function handleMessage(
  context: ConnectionContext,
  message: WebSocketMessage,
) {
  const { id, type, channel, data } = message;

  logger.debug({ messageId: id, type, channel }, 'WebSocket message received');

  const response: WebSocketMessage = {
    id,
    type: 'response',
    channel,
    timestamp: Date.now(),
  };

  try {
    switch (type) {
      case 'request':
        if (channel === 'auth.verify') {
          response.data = {
            authenticated: !!context.auth,
            userId: context.auth?.userId,
          };
        } else if (channel === 'reasoning.start') {
          handleReasoningRequest(context, data as ReasoningRequest);
          response.data = {
            queued: true,
            sessionId: (data as ReasoningRequest).sessionId,
          };
        } else if (channel === 'subscribe') {
          if (
            !data ||
            typeof data !== 'object' ||
            !('channel' in data) ||
            typeof data.channel !== 'string'
          ) {
            throw new Error('A subscription channel is required');
          }
          context.subscriptions.add(data.channel);
          if (!channels.has(data.channel)) {
            channels.set(data.channel, new Set());
          }
          channels.get(data.channel)!.add(context.id);
          response.data = { subscribed: data.channel };
        } else {
          response.error = {
            code: 'UNKNOWN_CHANNEL',
            message: 'Unknown channel',
          };
        }
        break;

      case 'stream':
        if (channel === 'reasoning.stream') {
          // Stream handling is continuous; response confirms receipt
          response.data = { streaming: true };
        }
        break;

      default:
        response.error = {
          code: 'UNKNOWN_TYPE',
          message: 'Unknown message type',
        };
    }
  } catch (err: unknown) {
    response.error = {
      code: 'HANDLER_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  sendMessage(context.ws, response);
}

/**
 * Schedule four simulated progress events 400 milliseconds apart using request.sessionId.
 * Events are sent only while the socket is open; the prompt is not evaluated.
 */
function handleReasoningRequest(
  context: ConnectionContext,
  request: ReasoningRequest,
) {
  // Simulate streaming response
  const { sessionId } = request;

  // Send progress events
  [
    'Parsing context...',
    'Initializing LangGraph...',
    'Processing...',
    'Complete',
  ].forEach((msg, idx) => {
    setTimeout(() => {
      const event: WebSocketMessage = {
        id: uuid(),
        type: 'stream',
        channel: 'reasoning.stream',
        data: {
          type: msg === 'Complete' ? 'complete' : 'progress',
          progress: ((idx + 1) / 4) * 100,
          message: msg,
          sessionId,
        },
        timestamp: Date.now(),
      };

      if (context.ws.readyState === context.ws.OPEN) {
        sendMessage(context.ws, event);
      }
    }, idx * 400);
  });
}

/** Send an event to open connections subscribed to channel; send/serialization errors propagate. */
export function broadcast(channel: string, data: unknown) {
  const event: WebSocketMessage = {
    id: uuid(),
    type: 'event',
    channel,
    data,
    timestamp: Date.now(),
  };

  const subs = channels.get(channel);
  if (subs) {
    subs.forEach((connId) => {
      const conn = connections.get(connId);
      if (conn && conn.ws.readyState === conn.ws.OPEN) {
        sendMessage(conn.ws, event);
      }
    });
  }
}

function sendMessage(ws: WebSocket, message: WebSocketMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, code: string, message: string) {
  const msg: WebSocketMessage = {
    id: uuid(),
    type: 'error',
    channel: 'system',
    error: { code, message },
    timestamp: Date.now(),
  };
  sendMessage(ws, msg);
}

/** Build a five-minute connection context from an already verified authUser, or return undefined. */
function extractAuth(request: FastifyRequest): AuthContext | undefined {
  const user = request.authUser;
  if (!user) return undefined;
  return {
    userId: user.id,
    email: user.email || '',
    name: user.email || user.id,
    roles: [user.role],
    sessionId: uuid(),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
}
