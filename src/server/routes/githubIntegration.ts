import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { requireUser } from './auth.js';
import {
  buildGitHubAuthorizationUrl,
  createGitHubOAuthState,
  decryptGitHubSecret,
  encryptGitHubSecret,
  GITHUB_API_VERSION,
  GITHUB_APP_REPOSITORY,
  getGitHubReturnUrl,
  githubOAuthStateHash,
  parseGitHubTokenTimes,
  readGitHubAppConfig,
  type GitHubAppConfig,
} from '../githubAppOAuth.js';

type GitHubTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
};

type GitHubUser = { id?: number; login?: string; avatar_url?: string };
type GitHubRepository = { id?: number; full_name?: string; permissions?: Record<string, boolean> };
type StoredConnection = {
  userId: string;
  githubUserId: string;
  githubLogin: string;
  repositoryId: string;
  repositoryFullName: string;
  repositoryPermissions: unknown;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  connectedAt: Date;
  updatedAt: Date;
};

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

class GitHubOAuthError extends Error {
  constructor(readonly publicCode: string) {
    super(publicCode);
    this.name = 'GitHubOAuthError';
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

async function exchangeGitHubCode(
  config: GitHubAppConfig,
  code: string,
  codeVerifier: string,
): Promise<GitHubTokenResponse> {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.callbackUrl,
    code_verifier: codeVerifier,
  });
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await readJson(response);
  if (!response.ok || typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
    throw new GitHubOAuthError('github_token_exchange_failed');
  }
  return payload as GitHubTokenResponse;
}

async function refreshGitHubToken(config: GitHubAppConfig, refreshToken: string): Promise<GitHubTokenResponse> {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await readJson(response);
  if (!response.ok || typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
    throw new GitHubOAuthError('github_token_refresh_failed');
  }
  return payload as GitHubTokenResponse;
}

async function githubApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch('https://api.github.com/' + path.replace(/^\/+/, ''), {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + accessToken,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new GitHubOAuthError('github_repository_verification_failed');
  return await response.json() as T;
}

async function revokeGitHubGrant(config: GitHubAppConfig, accessToken: string): Promise<boolean> {
  try {
    const basic = Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64');
    const response = await fetch(
      'https://api.github.com/applications/' + encodeURIComponent(config.clientId) + '/token',
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Basic ' + basic,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    return response.status === 204;
  } catch {
    return false;
  }
}

async function claimOAuthState(fastify: FastifyInstance, state: string) {
  const stateHash = githubOAuthStateHash(state);
  const now = new Date();
  const pending = await fastify.prisma.githubOAuthState.findUnique({ where: { stateHash } });
  if (!pending || pending.expiresAt.getTime() <= now.getTime()) {
    if (pending) await fastify.prisma.githubOAuthState.deleteMany({ where: { stateHash } });
    return null;
  }
  const claimed = await fastify.prisma.githubOAuthState.deleteMany({
    where: { stateHash, expiresAt: { gt: now } },
  });
  return claimed.count === 1 ? pending : null;
}

async function getUsableAccessToken(
  fastify: FastifyInstance,
  config: GitHubAppConfig,
  connection: StoredConnection,
): Promise<string | null> {
  try {
    const now = new Date();
    if (!connection.accessTokenExpiresAt ||
        connection.accessTokenExpiresAt.getTime() > now.getTime() + REFRESH_SKEW_MS) {
      return decryptGitHubSecret(connection.encryptedAccessToken, config.encryptionKey);
    }
    if (!connection.encryptedRefreshToken ||
        (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt.getTime() <= now.getTime())) {
      return null;
    }

    const refreshToken = decryptGitHubSecret(connection.encryptedRefreshToken, config.encryptionKey);
    const refreshed = await refreshGitHubToken(config, refreshToken);
    const tokenTimes = parseGitHubTokenTimes(refreshed);
    if (!refreshed.access_token || !refreshed.refresh_token ||
        !tokenTimes.accessTokenExpiresAt || !tokenTimes.refreshTokenExpiresAt) return null;

    const updated = await fastify.prisma.githubAppConnection.updateMany({
      where: { userId: connection.userId, encryptedRefreshToken: connection.encryptedRefreshToken },
      data: {
        encryptedAccessToken: encryptGitHubSecret(refreshed.access_token, config.encryptionKey),
        encryptedRefreshToken: encryptGitHubSecret(refreshed.refresh_token, config.encryptionKey),
        accessTokenExpiresAt: tokenTimes.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokenTimes.refreshTokenExpiresAt,
        updatedAt: new Date(),
      },
    });
    if (updated.count === 1) return refreshed.access_token;

    // A concurrent status request may already have rotated the single-use
    // refresh token. Read the winner's replacement instead of reusing the old one.
    const latest = await fastify.prisma.githubAppConnection.findUnique({
      where: { userId: connection.userId },
    });
    if (!latest || (latest.accessTokenExpiresAt && latest.accessTokenExpiresAt.getTime() <= Date.now())) return null;
    return decryptGitHubSecret(latest.encryptedAccessToken, config.encryptionKey);
  } catch {
    return null;
  }
}

export const githubIntegrationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/github/status', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ status: 'not_connected' });
    const config = readGitHubAppConfig();
    if (!config) return { status: 'not_configured', connected: false };

    const connection = await fastify.prisma.githubAppConnection.findUnique({ where: { userId } });
    if (!connection) return { status: 'not_connected', connected: false, configured: true };

    const accessToken = await getUsableAccessToken(fastify, config, connection as StoredConnection);
    if (!accessToken) {
      return {
        status: 'reauthorization_required',
        connected: false,
        account: { login: connection.githubLogin },
        repository: { fullName: connection.repositoryFullName },
      };
    }

    try {
      const [account, repository] = await Promise.all([
        githubApi<GitHubUser>('user', accessToken),
        githubApi<GitHubRepository>('repos/' + GITHUB_APP_REPOSITORY, accessToken),
      ]);
      const verified = String(account.id ?? '') === connection.githubUserId
        && repository.full_name === GITHUB_APP_REPOSITORY
        && repository.permissions?.pull === true;
      if (!verified) {
        return {
          status: 'repository_access_missing',
          connected: false,
          account: typeof account.login === 'string'
            ? { login: account.login, avatarUrl: account.avatar_url }
            : undefined,
          repository: { fullName: GITHUB_APP_REPOSITORY, permissions: repository.permissions ?? {} },
        };
      }
      return {
        status: 'connected',
        connected: true,
        account: { login: account.login, avatarUrl: account.avatar_url },
        repository: { fullName: repository.full_name, permissions: repository.permissions ?? {} },
        accessTokenExpiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
      };
    } catch {
      return {
        status: 'unverified',
        connected: false,
        message: 'GitHub could not verify this connection. Try refreshing the status.',
      };
    }
  });

  fastify.get('/api/github/connect', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in before connecting GitHub.' });
    const config = readGitHubAppConfig();
    if (!config) return reply.code(503).send({
      error: 'GitHub App registration and server-side encryption configuration are required.',
    });

    const oauth = createGitHubOAuthState();
    const now = new Date();
    await fastify.prisma.githubOAuthState.deleteMany({ where: { expiresAt: { lte: now } } });
    await fastify.prisma.githubOAuthState.create({
      data: {
        stateHash: oauth.stateHash,
        userId,
        encryptedCodeVerifier: encryptGitHubSecret(oauth.codeVerifier, config.encryptionKey),
        expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      },
    });
    return {
      authorizationUrl: buildGitHubAuthorizationUrl(config, oauth.state, oauth.codeChallenge),
      expiresInSeconds: STATE_TTL_MS / 1000,
    };
  });

  // OAuth code and state arrive in the query string; keep them out of access logs.
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/github/callback',
    { logLevel: 'silent' },
    async (request, reply) => {
      const config = readGitHubAppConfig();
      if (!config) return reply.code(503).send({ error: 'GitHub App configuration is incomplete.' });
      const { code, state, error } = request.query ?? {};
      if (!state || state.length > 200) {
        return reply.code(400).send({ error: 'The GitHub authorization state is missing or invalid.' });
      }

      const pending = await claimOAuthState(fastify, state);
      if (!pending) {
        return reply.code(400).send({ error: 'The GitHub authorization state is expired or invalid. Start again from RyanAI.' });
      }
      if (error) return reply.redirect(getGitHubReturnUrl(config, 'denied'));
      if (!code || code.length > 2000) return reply.redirect(getGitHubReturnUrl(config, 'error'));

      let accessToken: string | undefined;
      try {
        const verifier = decryptGitHubSecret(pending.encryptedCodeVerifier, config.encryptionKey);
        const tokens = await exchangeGitHubCode(config, code, verifier);
        accessToken = tokens.access_token;
        const tokenTimes = parseGitHubTokenTimes(tokens);
        if (!accessToken || !tokens.refresh_token ||
            !tokenTimes.accessTokenExpiresAt || !tokenTimes.refreshTokenExpiresAt) {
          throw new GitHubOAuthError('github_expiring_token_required');
        }

        const [account, repository] = await Promise.all([
          githubApi<GitHubUser>('user', accessToken),
          githubApi<GitHubRepository>('repos/' + GITHUB_APP_REPOSITORY, accessToken),
        ]);
        if (!account.id || typeof account.login !== 'string' ||
            repository.full_name !== GITHUB_APP_REPOSITORY || repository.permissions?.pull !== true) {
          await revokeGitHubGrant(config, accessToken);
          accessToken = undefined;
          throw new GitHubOAuthError('github_repository_access_not_verified');
        }

        await fastify.prisma.githubAppConnection.upsert({
          where: { userId: pending.userId },
          create: {
            userId: pending.userId,
            githubUserId: String(account.id),
            githubLogin: account.login,
            repositoryId: String(repository.id ?? ''),
            repositoryFullName: GITHUB_APP_REPOSITORY,
            repositoryPermissions: repository.permissions ?? {},
            encryptedAccessToken: encryptGitHubSecret(accessToken, config.encryptionKey),
            encryptedRefreshToken: encryptGitHubSecret(tokens.refresh_token, config.encryptionKey),
            accessTokenExpiresAt: tokenTimes.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokenTimes.refreshTokenExpiresAt,
          },
          update: {
            githubUserId: String(account.id),
            githubLogin: account.login,
            repositoryId: String(repository.id ?? ''),
            repositoryFullName: GITHUB_APP_REPOSITORY,
            repositoryPermissions: repository.permissions ?? {},
            encryptedAccessToken: encryptGitHubSecret(accessToken, config.encryptionKey),
            encryptedRefreshToken: encryptGitHubSecret(tokens.refresh_token, config.encryptionKey),
            accessTokenExpiresAt: tokenTimes.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokenTimes.refreshTokenExpiresAt,
            connectedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        return reply.redirect(getGitHubReturnUrl(config, 'connected'));
      } catch (cause) {
        if (accessToken) await revokeGitHubToken(config, accessToken);
        request.log.warn({
          reason: cause instanceof GitHubOAuthError ? cause.publicCode : 'oauth_callback_failed',
        }, 'GitHub authorization was not completed');
        return reply.redirect(getGitHubReturnUrl(config, 'error'));
      }
    },
  );

  fastify.post('/api/github/disconnect', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in before disconnecting GitHub.' });
    const connection = await fastify.prisma.githubAppConnection.findUnique({ where: { userId } });
    if (!connection) return { disconnected: true, remoteRevocation: 'not_needed' };

    let remoteRevoked = false;
    const config = readGitHubAppConfig();
    if (config) {
      try {
        const accessToken = await getUsableAccessToken(fastify, config, connection as StoredConnection);
        if (accessToken) remoteRevoked = await revokeGitHubGrant(config, accessToken);
      } catch {
        remoteRevoked = false;
      }
    }
    await fastify.prisma.githubAppConnection.deleteMany({ where: { userId } });
    return {
      disconnected: true,
      remoteRevocation: remoteRevoked ? 'confirmed' : 'unconfirmed',
    };
  });
};
