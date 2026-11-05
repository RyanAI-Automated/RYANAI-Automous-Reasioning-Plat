import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptGitHubSecret,
  encryptGitHubSecret,
  GITHUB_APP_REPOSITORY,
} from '../githubAppOAuth.js';
import { githubIntegrationRoutes } from './githubIntegration.js';
import { installAuthentication } from './auth.js';

const store = vi.hoisted(() => ({
  state: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
  connection: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
const apps: FastifyInstance[] = [];
const userId = '00000000-0000-4000-8000-000000000123';
const encryptionKey = Buffer.alloc(32, 0xa7);
const rawAccessToken = 'ghu.synthetic-access-token';
const rawRefreshToken = 'ghr.synthetic-refresh-token';

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function storedConnection(overrides: Record<string, unknown> = {}) {
  return {
    userId,
    githubUserId: '123456',
    githubLogin: 'synthetic-owner',
    repositoryId: '1361308785',
    repositoryFullName: GITHUB_APP_REPOSITORY,
    repositoryPermissions: { pull: true, push: false },
    encryptedAccessToken: encryptGitHubSecret(rawAccessToken, encryptionKey),
    encryptedRefreshToken: encryptGitHubSecret(rawRefreshToken, encryptionKey),
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    connectedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function createApp() {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('authUser', null);
  app.decorate('prisma', {
    githubOAuthState: store.state,
    githubAppConnection: store.connection,
  } as unknown as PrismaClient);
  app.addHook('onRequest', async (request) => {
    if (request.headers.authorization === 'Bearer test-user') {
      request.authUser = { id: userId, email: 'owner@example.test', role: 'user', isOwner: false };
    }
  });
  installAuthentication(app);
  await app.register(githubIntegrationRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.8a61f9b3a7aba766');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'synthetic-client-secret');
  vi.stubEnv('GITHUB_APP_CALLBACK_URL', 'https://api.example.test/api/github/callback');
  vi.stubEnv('GITHUB_APP_RETURN_URL', 'https://app.example.test/');
  vi.stubEnv('GITHUB_TOKEN_ENCRYPTION_KEY', 'a7'.repeat(32));
  store.state.create.mockImplementation(async ({ data }) => data);
  store.state.deleteMany.mockResolvedValue({ count: 1 });
  store.state.findUnique.mockResolvedValue(null);
  store.connection.findUnique.mockResolvedValue(null);
  store.connection.upsert.mockResolvedValue({});
  store.connection.updateMany.mockResolvedValue({ count: 1 });
  store.connection.deleteMany.mockResolvedValue({ count: 1 });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GitHub App in-app authorization lifecycle', () => {
  it('requires a verified RyanAI session to start or inspect a connection', async () => {
    const app = await createApp();
    const connect = await app.inject({ method: 'GET', url: '/api/github/connect' });
    const status = await app.inject({ method: 'GET', url: '/api/github/status' });
    expect(connect.statusCode).toBe(401);
    expect(status.statusCode).toBe(401);
    expect(store.state.create).not.toHaveBeenCalled();
    expect(store.connection.findUnique).not.toHaveBeenCalled();
  });

  it('allows the public callback to reach one-time state validation without an application session', async () => {
    const app = await createApp();
    const callback = await app.inject({
      method: 'GET',
      url: '/api/github/callback?code=synthetic-code&state=unknown-state',
    });
    expect(callback.statusCode).toBe(400);
    expect(callback.json().error).toContain('state is expired or invalid');
    expect(fetch).not.toHaveBeenCalled();
    expect(store.connection.upsert).not.toHaveBeenCalled();
  });

  it('fails closed when the GitHub App is not registered or its encryption key is missing', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', '');
    const app = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/api/github/connect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(503);
    expect(store.state.create).not.toHaveBeenCalled();
  });

  it('starts an authenticated PKCE flow and stores only hashed state plus encrypted verifier', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/api/github/connect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    const authorizationUrl = new URL(response.json().authorizationUrl);
    const created = store.state.create.mock.calls[0][0].data;
    expect(created.userId).toBe(userId);
    expect(created.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(authorizationUrl.searchParams.get('state')).not.toBe(created.stateHash);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('scope')).toBe('offline_access');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('https://api.example.test/api/github/callback');
    expect(created.encryptedCodeVerifier).toMatch(/^v1\./);
    expect(decryptGitHubSecret(created.encryptedCodeVerifier, encryptionKey)).toHaveLength(43);
  });

  it('rejects missing, expired or already-claimed OAuth state before exchanging a code', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/api/github/callback?code=synthetic-code&state=unknown-state',
    });
    expect(response.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.connection.upsert).not.toHaveBeenCalled();
  });

  it('exchanges the code, verifies the GitHub identity and official repo, then persists encrypted tokens', async () => {
    const app = await createApp();
    let pending: Record<string, unknown> | null = null;
    store.state.create.mockImplementation(async ({ data }) => { pending = data; return data; });
    store.state.findUnique.mockImplementation(async () => pending);
    const authorization = await app.inject({
      method: 'GET', url: '/api/github/connect',
      headers: { authorization: 'Bearer test-user' },
    });
    const state = new URL(authorization.json().authorizationUrl).searchParams.get('state')!;
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response({
        access_token: rawAccessToken,
        refresh_token: rawRefreshToken,
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
      }))
      .mockResolvedValueOnce(response({ id: 123456, login: 'synthetic-owner', avatar_url: 'https://avatars.example.test/owner.png' }))
      .mockResolvedValueOnce(response({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true, push: false, admin: false },
      }));

    const callback = await app.inject({
      method: 'GET',
      url: '/api/github/callback?code=synthetic-code&state=' + encodeURIComponent(state),
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('https://app.example.test/?github=connected');
    expect(store.state.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { stateHash: pending?.stateHash, expiresAt: { gt: expect.any(Date) } },
    }));
    expect(store.connection.upsert).toHaveBeenCalledTimes(1);
    const persisted = store.connection.upsert.mock.calls[0][0].create;
    expect(persisted.userId).toBe(userId);
    expect(persisted.githubLogin).toBe('synthetic-owner');
    expect(persisted.repositoryFullName).toBe(GITHUB_APP_REPOSITORY);
    expect(persisted.encryptedAccessToken).toMatch(/^v1\./);
    expect(persisted.encryptedRefreshToken).toMatch(/^v1\./);
    expect(persisted.encryptedAccessToken).not.toContain(rawAccessToken);
    expect(persisted.encryptedRefreshToken).not.toContain(rawRefreshToken);
    expect(callback.body).not.toContain(rawAccessToken);
  });

  it('does not persist a token when the official repository permission is missing', async () => {
    const app = await createApp();
    let pending: Record<string, unknown> | null = null;
    store.state.create.mockImplementation(async ({ data }) => { pending = data; return data; });
    store.state.findUnique.mockImplementation(async () => pending);
    const authorization = await app.inject({
      method: 'GET', url: '/api/github/connect',
      headers: { authorization: 'Bearer test-user' },
    });
    const state = new URL(authorization.json().authorizationUrl).searchParams.get('state')!;
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({
        access_token: rawAccessToken,
        refresh_token: rawRefreshToken,
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
      }))
      .mockResolvedValueOnce(response({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(response({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: false, push: false },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const callback = await app.inject({
      method: 'GET',
      url: '/api/github/callback?code=synthetic-code&state=' + encodeURIComponent(state),
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('https://app.example.test/?github=error');
    expect(store.connection.upsert).not.toHaveBeenCalled();
  });

  it('reports a verified connection without returning either credential to the browser', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(response({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true, push: false },
      }));
    const app = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/api/github/status',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: GITHUB_APP_REPOSITORY, permissions: { pull: true, push: false } },
    });
    expect(response.body).not.toContain(rawAccessToken);
    expect(response.body).not.toContain(rawRefreshToken);
  });

  it('rotates an expiring access and refresh token before reporting status', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection({
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
    }));
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({
        access_token: 'ghu.rotated-access-token',
        refresh_token: 'ghr.rotated-refresh-token',
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
      }))
      .mockResolvedValueOnce(response({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(response({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true, push: false },
      }));
    const app = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/api/github/status',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('connected');
    expect(store.connection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId, encryptedRefreshToken: expect.any(String) }),
      data: expect.objectContaining({ accessTokenExpiresAt: expect.any(Date), refreshTokenExpiresAt: expect.any(Date) }),
    }));
    expect(response.body).not.toContain('ghu.rotated-access-token');
  });

  it('revokes the remote token and removes local credentials on disconnect', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/github/disconnect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ disconnected: true, remoteRevocation: 'confirmed' });
    expect(store.connection.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    const [target, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(target)).toBe('https://api.github.com/applications/Iv1.8a61f9b3a7aba766/grant');
    expect(options?.method).toBe('DELETE');
    expect(JSON.parse(String(options?.body))).toEqual({ access_token: rawAccessToken });
  });

  it('removes local credentials even when remote revocation is unavailable', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network failure'));
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/github/disconnect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ disconnected: true, remoteRevocation: 'unconfirmed' });
    expect(store.connection.deleteMany).toHaveBeenCalledWith({ where: { userId } });
  });
});
