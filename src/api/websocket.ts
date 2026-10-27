// src/api/websocket.ts - Real-time WebSocket bridge
import { FastifyInstance, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { WebSocketMessage, AuthContext, ReasoningRequest } from '../shared/types.js';
import { createLogger } from '../shared/logger.js';
import { requireAdmin } from '../server/routes/auth.js';

const logger = createLogger('websocket');

interface ConnectionContext {
  id: string;
  ws: WebSocket;
  auth?: AuthContext;
  subscriptions: Set<string>;
  messageCount: number;
  connectedAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  messageWindowTimer?: ReturnType<typeof setTimeout>;
  closed?: boolean;
}

const connections = new Map<string, ConnectionContext>();
const channels = new Map<string, Set<string>>();

export async function registerWebSocketRoutes(fastify: FastifyInstance) {
  logger.info('Registering WebSocket routes');

  fastify.get(
    '/ws',
    {
      websocket: true,
      preValidation: requireAdmin,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (socket, request: FastifyRequest) => {
      const connId = uuid();
      const auth = extractAuth(request);

      const context: ConnectionContext = {
        id: connId,
        ws: socket as WebSocket,
        auth,
        subscriptions: new Set(),
        messageCount: 0,
        connectedAt: Date.now(),
        closed: false,
      };

      connections.set(connId, context);
      logger.info({ connId, auth: auth?.email }, 'WebSocket connected');

      context.expiryTimer = setTimeout(() => {
        if (socket.readyState === socket.OPEN) {
          socket.close(1008, 'Reauthenticate');
        }
      }, 300_000);

      socket.on('message', async (data: Buffer) => {
        if (context.closed || socket.readyState !== socket.OPEN) return;

        // Start one fixed 60-second window when the first message arrives.
        if (context.messageCount === 0 && !context.messageWindowTimer) {
          context.messageWindowTimer = setTimeout(() => {
            context.messageCount = 0;
            context.messageWindowTimer = undefined;
          }, 60_000);
        }

        // Count every message, including malformed JSON.
        if (context.messageCount >= 60) {
          sendError(
            socket as WebSocket,
            'RATE_LIMITED',
            'Message rate limit exceeded',
          );
          socket.close(1008, 'Message rate limit exceeded');
          return;
        }

        context.messageCount += 1;

        try {
          const message = JSON.parse(data.toString()) as WebSocketMessage;
          await handleMessage(context, message);
        } catch (err) {
          logger.error({ err, connId }, 'Message handling error');
          sendError(
            socket as WebSocket,
            'PARSE_ERROR',
            'Invalid message format',
          );
        }
      });

      socket.on('close', () => {
        context.closed = true;

        if (context.expiryTimer) {
          clearTimeout(context.expiryTimer);
          context.expiryTimer = undefined;
        }

        if (context.messageWindowTimer) {
          clearTimeout(context.messageWindowTimer);
          context.messageWindowTimer = undefined;
        }

        connections.delete(connId);

        context.subscriptions.forEach((channel) => {
          const channelSubs = channels.get(channel);
          if (channelSubs) {
            channelSubs.delete(connId);
            if (channelSubs.size === 0) channels.delete(channel);
          }
        });

        context.subscriptions.clear();
        logger.info({ connId }, 'WebSocket disconnected');
      });

      socket.on('error', (err) => {
        logger.error({ err, connId }, 'WebSocket error');
      });
    },
  );
}

async function handleMessage(context: ConnectionContext, message: WebSocketMessage) {
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
          response.data = { authenticated: !!context.auth, userId: context.auth?.userId };
        } else if (channel === 'reasoning.start') {
          handleReasoningRequest(context, data as ReasoningRequest);
          response.data = { queued: true, sessionId: (data as ReasoningRequest).sessionId };
        } else if (channel === 'subscribe') {
          if (!data || typeof data !== 'object' || !('channel' in data) || typeof data.channel !== 'string') {
            throw new Error('A subscription channel is required');
          }
          context.subscriptions.add(data.channel);
          if (!channels.has(data.channel)) {
            channels.set(data.channel, new Set());
          }
          channels.get(data.channel)!.add(context.id);
          response.data = { subscribed: data.channel };
        } else {
          response.error = { code: 'UNKNOWN_CHANNEL', message: 'Unknown channel' };
        }
        break;

      case 'stream':
        if (channel === 'reasoning.stream') {
          // Stream handling is continuous; response confirms receipt
          response.data = { streaming: true };
        }
        break;

      default:
        response.error = { code: 'UNKNOWN_TYPE', message: 'Unknown message type' };
    }
  } catch (err: unknown) {
    response.error = { code: 'HANDLER_ERROR', message: (err instanceof Error ? err.message : String(err)) };
  }

  sendMessage(context.ws, response);
}

function handleReasoningRequest(context: ConnectionContext, request: ReasoningRequest) {
  // Simulate streaming response
  const { sessionId } = request;

  // Send progress events
  ['Parsing context...', 'Initializing LangGraph...', 'Processing...', 'Complete'].forEach(
    (msg, idx) => {
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
    }
  );
}

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
    subs.forEach(connId => {
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

function extractAuth(request: FastifyRequest): AuthContext | undefined {
  if (!request.authUser) return undefined;
  return {
    userId: request.authUser.id,
    email: request.authUser.email ?? '',
    name: request.authUser.email || request.authUser.id,
    roles: [request.authUser.role],
    sessionId: uuid(),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 86400000,
  };
}

export default registerWebSocketRoutes;