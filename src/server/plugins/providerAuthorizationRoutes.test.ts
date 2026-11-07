import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerAuthorizationRoutes } from './providerAuthorizationRoutes.js';
import { encryptProviderCredential } from './providerAuthorization.js';

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
      findMany: vi.fn(async ({ where, select }: { where: { ownerUserId: string }; select?: Record<string, boolean> }) =>
        [...connectionRows.values()]
          .filter((row) => row.ownerUserId === where.ownerUserId)
          .map((row) => select
            ? Object.fromEntries(Object.entries(select).filter(([, include]) => include).map(([field]) => [field, row[field]]))
            : row)),
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

  it('requests Microsoft offline access but requires only returned API scopes', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID', 'synthetic-ms-client');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET', 'synthetic-ms-secret');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/microsoft-365-calendar/callback');
    const { app } = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/plugins/microsoft-365-calendar/connect' });
    expect(response.statusCode).toBe(200);
    const url = new URL((response.json() as { authorizationUrl: string }).authorizationUrl);
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('scope')).toContain('Calendars.Read');
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
      token_type: 'Bearer',
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

  it('refreshes only the signed-in owner connection and persists rotated encrypted tokens', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, prisma, connectionRows, events } = await createApp();
    const refreshCipher = encryptProviderCredential(
      'synthetic-refresh-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1:refresh',
    );
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-1', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedRefreshToken: refreshCipher,
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'rotated-access-token',
      token_type: 'Bearer',
      refresh_token: 'rotated-refresh-token',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/refresh' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ refreshed: true, provider: 'google-calendar' });
    expect(prisma.pluginProviderConnection.updateMany).toHaveBeenCalledOnce();
    const updateArgs = (prisma.pluginProviderConnection.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.encryptedAccessToken).not.toContain('rotated-access-token');
    expect(updateArgs.data.encryptedRefreshToken).not.toContain('rotated-refresh-token');
    expect(events.some((event) => event.eventType === 'token_refreshed')).toBe(true);
    await app.close();
  });

  it('preserves an active connection when provider refresh is temporarily unavailable', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, prisma, connectionRows } = await createApp();
    const refreshCipher = encryptProviderCredential(
      'synthetic-refresh-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1:refresh',
    );
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-1', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedRefreshToken: refreshCipher,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503 })));
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/refresh' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('existing connection has been preserved');
    expect(prisma.pluginProviderConnection.updateMany).not.toHaveBeenCalled();
    expect(connectionRows.get(`${owner.id}:google-calendar`)?.status).toBe('connected');
    await app.close();
  });

  it('requires reauthorization only when provider explicitly invalidates the refresh grant', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, prisma, connectionRows } = await createApp();
    const refreshCipher = encryptProviderCredential(
      'synthetic-refresh-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1:refresh',
    );
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-1', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedRefreshToken: refreshCipher,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/refresh' });
    expect(response.statusCode).toBe(409);
    expect(prisma.pluginProviderConnection.updateMany).toHaveBeenCalledOnce();
    const updateArgs = (prisma.pluginProviderConnection.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.status).toBe('reauthorization_required');
    await app.close();
  });

  it('purges local Microsoft tokens and reports remote revocation as pending when unsupported', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID', 'synthetic-ms-client');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET', 'synthetic-ms-secret');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/microsoft-365-calendar/callback');
    const { app, prisma, connectionRows, events } = await createApp();
    connectionRows.set(`${owner.id}:microsoft-365-calendar`, {
      id: 'connection-2', ownerUserId: owner.id, providerId: 'microsoft-365-calendar',
      status: 'connected', encryptedAccessToken: 'ciphertext', encryptedRefreshToken: 'ciphertext',
    });
    const response = await app.inject({ method: 'POST', url: '/api/plugins/microsoft-365-calendar/disconnect' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      disconnected: true, localCredentialsPurged: true, remoteRevocation: 'pending',
    });
    expect(prisma.pluginProviderConnection.update).toHaveBeenCalledOnce();
    const updateArgs = (prisma.pluginProviderConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.encryptedAccessToken).toBeNull();
    expect(updateArgs.data.encryptedRefreshToken).toBeNull();
    expect(updateArgs.data.status).toBe('revocation_pending');
    expect(events.some((event) => event.eventType === 'revocation_pending')).toBe(true);
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
