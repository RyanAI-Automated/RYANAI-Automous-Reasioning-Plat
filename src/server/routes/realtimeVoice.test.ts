import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { realtimeVoiceRoutes } from './realtimeVoice.js';

const apps: FastifyInstance[] = [];
const tickets = new Map<string, string>();
const redis = {
  set: vi.fn(async (key: string, value: string, _expiry: string, _seconds: number, _mode: string) => {
    if (tickets.has(key)) return null;
    tickets.set(key, value);
    return 'OK';
  }),
  getdel: vi.fn(async (key: string) => {
    const value = tickets.get(key) ?? null;
    tickets.delete(key);
    return value;
  }),
};

async function createApp() {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('authUser', null);
  app.decorate('redis', redis as never);
  app.addHook('onRequest', async (request) => {
    if (request.headers.authorization === 'Bearer test-user') {
      request.authUser = {
        id: 'user-123',
        email: 'owner@example.test',
        role: 'user',
        isOwner: true,
      };
    }
  });
  await app.register(websocket);
  await app.register(realtimeVoiceRoutes);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  tickets.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('authenticated realtime voice gateway', () => {
  it('requires a verified user before issuing a short-lived ticket', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/realtime/voice-ticket' });
    expect(response.statusCode).toBe(401);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('issues a random single-use ticket with a 30-second Redis expiry', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/voice-ticket',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ expiresIn: 30 });
    expect(response.json().ticket).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(redis.set).toHaveBeenCalledWith(
      `ryanai:realtime-voice:${response.json().ticket}`,
      JSON.stringify({ userId: 'user-123', isOwner: true, language: 've-ZA' }),
      'EX',
      30,
      'NX',
    );
  });

  it('rejects missing and replayed WebSocket tickets', async () => {
    const app = await createApp();
    await expect(app.injectWS('/api/v1/realtime/voice')).rejects.toThrow(
      'Unexpected server response: 401',
    );
    tickets.set('ryanai:realtime-voice:one-use', JSON.stringify({ userId: '', isOwner: true, language: 've-ZA' }));
    await expect(app.injectWS('/api/v1/realtime/voice?ticket=one-use')).rejects.toThrow(
      'Unexpected server response: 401',
    );
    await expect(app.injectWS('/api/v1/realtime/voice?ticket=one-use')).rejects.toThrow(
      'Unexpected server response: 401',
    );
    expect(redis.getdel).toHaveBeenCalledTimes(2);
    expect(redis.getdel).toHaveBeenCalledWith('ryanai:realtime-voice:one-use');
  });

  it('rejects untrusted browser origins before consuming a ticket', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGINS', 'https://app.example.test');
    const app = await createApp();
    tickets.set('ryanai:realtime-voice:origin-check', JSON.stringify({ userId: 'user-123', isOwner: true, language: 've-ZA' }));
    await expect(app.injectWS('/api/v1/realtime/voice?ticket=origin-check', {
      headers: { origin: 'https://attacker.invalid' },
    })).rejects.toThrow('Unexpected server response: 403');
    expect(redis.getdel).not.toHaveBeenCalled();
  });
});
