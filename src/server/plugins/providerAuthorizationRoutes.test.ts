import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerAuthorizationRoutes } from './providerAuthorizationRoutes.js';

const owner = { id: 'owner-user-1', role: 'user' as const, isOwner: true };
const key = '5a'.repeat(32);

function createPrismaFixture() {
  const stateRows = new Map<string, Record<string, unknown>>();
  const connectionRows = new Map<string, Record<string, unknown>>();
  const events: Record<string, unknown>[] = [];
  const prisma = {
    pluginOAuthState: {
      deleteMany: vi.fn(async ({ where }: { where?: { stateHash?: string; expiresAt?: { lte?: Date; gt?: Date }; providerId?: string } }) => {
        if (where?.stateHash) {
          const row = stateRows.get(where.stateHash);
          if (row && (!where.expiresAt?.gt || (row.expiresAt as Date) > where.expiresAt.gt)) {
            stateRows.delete(where.stateHash);
            return { count: 1 };
          }
          return { count: 0 };
        }
        return { count: 0 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        stateRows.set(String(data.stateHash), data);
        return data;
      }),
      findUnique: vi.fn(async ({ where }: { where: { stateHash: string } }) => stateRows.get(where.stateHash) ?? null),
    },
    pluginProviderConnection: {
      findUnique: vi.fn(async ({ where }: { where: { ownerUserId_providerId: { ownerUserId: string; providerId: string } } }) =>
        connectionRows.get(`${where.ownerUserId_providerId.ownerUserId}:${where.ownerUserId_providerId.providerId}`) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { ownerUserId_providerId: { ownerUserId: string; providerId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const id = `${where.ownerUserId_providerId.ownerUserId}:${where.ownerUserId_providerId.providerId}`;
        const previous = connectionRows.get(id);
        const row = { id: 'connection-1', ...previous, ...(previous ? update : create) };
        connectionRows.set(id, row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { ownerUserId: string } }) =>
        [...connectionRows.values()].filter((row) => row.ownerUserId === where.ownerUserId)),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    pluginAuthorizationEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; }),
    },
  };
  return { prisma, stateRows, connectionRows, events };
}

async function createApp() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => { request.authUser = owner; });
  const fixture = createPrismaFixture();
  app.decorate('prisma', fixture.prisma as unknown as PrismaClient);
  await app.register(providerAuthorizationRoutes);
  return { app, ...fixture };
}

describe('provider authorization HTTP lifecycle', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('starts Google Calendar OAuth using server configuration and least-privilege read-only scope', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, prisma, stateRows } = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/connect' });
    expect(response.statusCode).toBe(200);
    const result = response.json() as { authorizationUrl: string; expiresInSeconds: number };
    const url = new URL(result.authorizationUrl);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(result.expiresInSeconds).toBe(600);
    expect(prisma.pluginOAuthState.create).toHaveBeenCalledOnce();
    expect(stateRows.size).toBe(1);
    const saved = [...stateRows.values()][0];
    expect(saved.ownerUserId).toBe(owner.id);
    expect(saved).not.toHaveProperty('state');
    expect(saved).not.toHaveProperty('codeVerifier');
    await app.close();
  });

  it('exchanges a one-time callback, validates scopes and stores encrypted tokens', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, stateRows, connectionRows, events } = await createApp();
    const start = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/connect' });
    const state = new URL((start.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get('state')!;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'synthetic-access-token',
      refresh_token: 'synthetic-refresh-token',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const callback = await app.inject({
      method: 'GET',
      url: `/api/plugins/oauth/google-calendar/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json()).toMatchObject({ connected: true, provider: 'google-calendar' });
    const saved = connectionRows.get(`${owner.id}:google-calendar`)!;
    expect(saved.status).toBe('connected');
    expect(saved.encryptedAccessToken).not.toContain('synthetic-access-token');
    expect(saved.encryptedRefreshToken).not.toContain('synthetic-refresh-token');
    expect(events.some((event) => event.eventType === 'authorization_completed')).toBe(true);
    expect(stateRows.size).toBe(0);
    const replay = await app.inject({
      method: 'GET',
      url: `/api/plugins/oauth/google-calendar/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
    });
    expect(replay.statusCode).toBe(400);
    await app.close();
  });

  it('does not expose credentials through the owner connection listing', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const { app, connectionRows } = await createApp();
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-1', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedAccessToken: 'ciphertext', encryptedRefreshToken: 'ciphertext',
      grantedScopes: ['calendar.readonly'], connectedAt: new Date(),
    });
    const response = await app.inject({ method: 'GET', url: '/api/plugins/connections' });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('encryptedAccessToken');
    expect(response.body).not.toContain('ciphertext');
    await app.close();
  });
});
