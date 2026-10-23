import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { broadcast, registerWebSocketRoutes } from './websocket';

vi.mock('../server/routes/auth.js', () => ({ requireAdmin: vi.fn() }));
vi.mock('../shared/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = this.OPEN;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit('close');
  });
}

let connect: (socket: Socket, request: FastifyRequest) => Promise<void>;
let sockets: Socket[];
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  sockets = [];
  const app = {
    rateLimit: vi.fn(() => vi.fn()),
    get: vi.fn((_path, _options, handler) => {
      connect = handler;
    }),
  };
  await registerWebSocketRoutes(app as unknown as FastifyInstance);
});
afterEach(() => {
  for (const socket of sockets) socket.close();
  vi.useRealTimers();
});

async function openSocket() {
  const socket = new Socket();
  sockets.push(socket);
  await connect(socket, {
    authUser: {
      id: 'verified-admin',
      email: 'admin@example.test',
      role: 'admin',
    },
  } as FastifyRequest);
  return socket;
}

async function request(socket: Socket, channel: string, data?: unknown) {
  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({ id: 'request-1', type: 'request', channel, data }),
    ),
  );
  await Promise.resolve();
}

describe('WebSocket session and message boundaries', () => {
  it('requires reauthentication at exactly five minutes', async () => {
    const socket = await openSocket();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(socket.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(
      1008,
      'Reauthenticate',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels expiry when the client disconnects', async () => {
    const socket = await openSocket();
    socket.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('accepts 60 messages, closes on the 61st, and ignores further messages', async () => {
    const socket = await openSocket();
    for (let index = 0; index < 60; index++)
      await request(socket, 'auth.verify');
    expect(socket.send).toHaveBeenCalledTimes(60);
    expect(socket.close).not.toHaveBeenCalled();
    await request(socket, 'auth.verify');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toMatchObject({
      type: 'error',
      error: { code: 'RATE_LIMITED' },
    });
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(
      1008,
      'Message rate limit exceeded',
    );
    await request(socket, 'auth.verify');
    expect(socket.send).toHaveBeenCalledTimes(61);
  });

  it('resets the budget at exactly one minute and keeps budgets independent per client', async () => {
    const first = await openSocket();
    const second = await openSocket();
    for (let index = 0; index < 60; index++)
      await request(first, 'auth.verify');
    await request(second, 'auth.verify');
    expect(second.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    await request(first, 'auth.verify');
    expect(first.close).not.toHaveBeenCalled();
    expect(JSON.parse(first.send.mock.calls.at(-1)![0])).toMatchObject({
      data: { authenticated: true, userId: 'verified-admin' },
    });
  });

  it('counts malformed messages toward the rate limit', async () => {
    const socket = await openSocket();
    for (let index = 0; index < 60; index++)
      socket.emit('message', Buffer.from('{'));
    expect(socket.send).toHaveBeenCalledTimes(60);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      error: { code: 'PARSE_ERROR' },
    });
    await request(socket, 'auth.verify');
    expect(socket.close).toHaveBeenCalledWith(
      1008,
      'Message rate limit exceeded',
    );
  });

  it.each([undefined, null, 'metrics', {}, { channel: 42 }])(
    'rejects invalid subscription data (%j) without closing the connection',
    async (data) => {
      const socket = await openSocket();
      await request(socket, 'subscribe', data);
      expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
        id: 'request-1',
        type: 'response',
        error: {
          code: 'HANDLER_ERROR',
          message: 'A subscription channel is required',
        },
      });
      broadcast('metrics', { cpu: 1 });
      expect(socket.send).toHaveBeenCalledOnce();
      expect(socket.close).not.toHaveBeenCalled();
    },
  );

  it('delivers broadcasts once to subscribers and removes disconnected subscriptions', async () => {
    const subscribed = await openSocket();
    const other = await openSocket();
    await request(subscribed, 'subscribe', { channel: 'metrics' });
    await request(subscribed, 'subscribe', { channel: 'metrics' });
    subscribed.send.mockClear();
    broadcast('metrics', { cpu: 0 });
    expect(subscribed.send).toHaveBeenCalledOnce();
    expect(JSON.parse(subscribed.send.mock.calls[0][0])).toMatchObject({
      type: 'event',
      channel: 'metrics',
      data: { cpu: 0 },
    });
    expect(other.send).not.toHaveBeenCalled();
    subscribed.close();
    // A late broadcast must not reach a removed connection, even if a stale
    // transport reference still reports OPEN.
    subscribed.readyState = subscribed.OPEN;
    broadcast('metrics', { cpu: 1 });
    expect(subscribed.send).toHaveBeenCalledOnce();
  });
});
