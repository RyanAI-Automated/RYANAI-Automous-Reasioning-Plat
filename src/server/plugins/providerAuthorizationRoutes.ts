import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { requireUser } from '../routes/auth.js';
import {
  buildProviderAuthorizationUrl,
  createProviderOAuthTransaction,
  decryptProviderCredential,
  encryptProviderCredential,
  encryptProviderTokenSet,
  nextProviderRevocationStatus,
  readProviderEncryptionKey,
  validateProviderGrantedScopes,
  type ProviderOAuthPolicy,
  type ProviderOAuthTokenSet,
} from './providerAuthorization.js';

type ProviderId = 'google-calendar' | 'microsoft-365-calendar';
type ProviderConfig = {
  id: ProviderId;
  policy: ProviderOAuthPolicy;
  requestedScopes: readonly string[];
  extraAuthorizationParams?: Readonly<Record<string, string>>;
  revokeEndpoint?: string;
};

type OAuthTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
};

const REQUEST_TIMEOUT_MS = 10_000;

function requiredEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function providerConfig(providerId: string): ProviderConfig | null {
  const encryptionKey = readProviderEncryptionKey(requiredEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY') ?? undefined);
  if (!encryptionKey) return null;

  if (providerId === 'google-calendar') {
    const clientId = requiredEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID');
    const clientSecret = requiredEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET');
    const redirectUri = requiredEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri) return null;
    const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
    return {
      id: 'google-calendar',
      policy: {
        providerId,
        clientId,
        clientSecret,
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        redirectUri,
        allowedScopes: scopes,
        requiredScopes: scopes,
      },
      requestedScopes: scopes,
      extraAuthorizationParams: { access_type: 'offline', prompt: 'consent' },
      revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
    };
  }

  if (providerId === 'microsoft-365-calendar') {
    const clientId = requiredEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID');
    const clientSecret = requiredEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET');
    const redirectUri = requiredEnv('RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri) return null;
    const scopes = ['offline_access', 'User.Read', 'Calendars.Read'];
    return {
      id: 'microsoft-365-calendar',
      policy: {
        providerId,
        clientId,
        clientSecret,
        authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        redirectUri,
        allowedScopes: scopes,
        requiredScopes: ['User.Read', 'Calendars.Read'],
      },
      requestedScopes: scopes,
    };
  }

  return null;
}

function encryptionKey(): Buffer {
  const key = readProviderEncryptionKey(requiredEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY') ?? undefined);
  if (!key) throw new Error('Provider authorization is not configured.');
  return key;
}

async function parseProviderTokenResponse(response: Response): Promise<OAuthTokenResponse> {
  return await response.json().catch(() => ({})) as OAuthTokenResponse;
}

async function exchangeAuthorizationCode(
  config: ProviderConfig,
  code: string,
  codeVerifier: string,
): Promise<ProviderOAuthTokenSet> {
  const endpoint = new URL(config.policy.tokenEndpoint);
  if (endpoint.protocol !== 'https:') throw new Error('OAuth token endpoint must use HTTPS.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.policy.clientId,
    client_secret: config.policy.clientSecret,
    redirect_uri: config.policy.redirectUri,
    code_verifier: codeVerifier,
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await parseProviderTokenResponse(response);
  if (!response.ok || typeof payload.access_token !== 'string' ||
      typeof payload.token_type !== 'string' || payload.token_type.toLowerCase() !== 'bearer' ||
      typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
    throw new Error('Provider authorization code exchange failed.');
  }
  const grantedScopes = typeof payload.scope === 'string'
    ? payload.scope.split(/\s+/).filter(Boolean)
    : [...config.requestedScopes];
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    accessTokenExpiresAt: typeof payload.expires_in === 'number'
      ? new Date(Date.now() + payload.expires_in * 1000) : null,
    refreshTokenExpiresAt: typeof payload.refresh_token_expires_in === 'number'
      ? new Date(Date.now() + payload.refresh_token_expires_in * 1000) : null,
    grantedScopes,
  };
}

class ProviderOAuthFailure extends Error {
  constructor(message: string, readonly requiresReauthorization: boolean) {
    super(message);
    this.name = 'ProviderOAuthFailure';
  }
}

async function refreshProviderToken(
  config: ProviderConfig,
  refreshToken: string,
): Promise<ProviderOAuthTokenSet> {
  const endpoint = new URL(config.policy.tokenEndpoint);
  if (endpoint.protocol !== 'https:') throw new Error('OAuth token endpoint must use HTTPS.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.policy.clientId,
    client_secret: config.policy.clientSecret,
    scope: config.requestedScopes.join(' '),
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await parseProviderTokenResponse(response);
  if (!response.ok) {
    throw new ProviderOAuthFailure(
      'Provider token refresh failed.',
      response.status === 400 && payload.error === 'invalid_grant',
    );
  }
  if (typeof payload.access_token !== 'string' ||
      typeof payload.token_type !== 'string' || payload.token_type.toLowerCase() !== 'bearer' ||
      typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
    throw new ProviderOAuthFailure('Provider returned an invalid refresh token response.', false);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : refreshToken,
    accessTokenExpiresAt: typeof payload.expires_in === 'number'
      ? new Date(Date.now() + payload.expires_in * 1000) : null,
    refreshTokenExpiresAt: typeof payload.refresh_token_expires_in === 'number'
      ? new Date(Date.now() + payload.refresh_token_expires_in * 1000) : null,
    grantedScopes: typeof payload.scope === 'string'
      ? payload.scope.split(/\s+/).filter(Boolean)
      : [...config.requestedScopes],
  };
}

async function revokeRemoteGrant(config: ProviderConfig, token: string): Promise<boolean> {
  if (!config.revokeEndpoint) return false;
  const endpoint = new URL(config.revokeEndpoint);
  if (endpoint.protocol !== 'https:') return false;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, client_id: config.policy.clientId, client_secret: config.policy.clientSecret }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function connectionEncryptionContext(providerId: string, ownerUserId: string) {
  return `plugin-token:${providerId}:${ownerUserId}`;
}

export const providerAuthorizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { provider: string } }>(
    '/api/plugins/:provider/connect',
    { preHandler: requireUser },
    async (request, reply) => {
      const ownerUserId = request.authUser?.id;
      if (!ownerUserId) return reply.code(401).send({ error: 'Sign in before connecting a provider.' });
      const config = providerConfig(request.params.provider);
      if (!config) return reply.code(503).send({ error: 'Provider OAuth is not configured or supported.' });

      const key = encryptionKey();
      const transaction = createProviderOAuthTransaction(config.id, key);
      const now = new Date();
      await fastify.prisma.pluginOAuthState.deleteMany({ where: { expiresAt: { lte: now } } });
      await fastify.prisma.pluginOAuthState.create({
        data: {
          stateHash: transaction.stateHash,
          ownerUserId,
          providerId: config.id,
          encryptedCodeVerifier: transaction.encryptedCodeVerifier,
          requestedScopes: [...config.requestedScopes],
          redirectUri: config.policy.redirectUri,
          expiresAt: transaction.expiresAt,
        },
      });
      await fastify.prisma.pluginAuthorizationEvent.create({
        data: {
          ownerUserId,
          providerId: config.id,
          eventType: 'authorization_started',
          actorUserId: ownerUserId,
          details: { requestedScopes: [...config.requestedScopes] },
        },
      });
      const authorizationUrl = new URL(buildProviderAuthorizationUrl(config.policy, transaction, config.requestedScopes));
      for (const [name, value] of Object.entries(config.extraAuthorizationParams ?? {})) {
        authorizationUrl.searchParams.set(name, value);
      }
      return { authorizationUrl: authorizationUrl.toString(), expiresInSeconds: 600 };
    },
  );

  // OAuth callbacks are unauthenticated at the HTTP layer but are bound to a
  // single-use state record created by a verified owner session.
  fastify.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/plugins/oauth/:provider/callback',
    { logLevel: 'silent' },
    async (request, reply) => {
      const config = providerConfig(request.params.provider);
      if (!config) return reply.code(503).send({ error: 'Provider OAuth is not configured.' });
      const { code, state, error } = request.query;
      if (!state || state.length > 200 || (!error && (!code || code.length > 4000))) {
        return reply.code(400).send({ error: 'Provider authorization callback was invalid.' });
      }

      const stateHash = createHash('sha256').update(state).digest('hex');
      const pending = await fastify.prisma.pluginOAuthState.findUnique({ where: { stateHash } });
      if (!pending || pending.providerId !== config.id || pending.expiresAt.getTime() <= Date.now()) {
        if (pending) await fastify.prisma.pluginOAuthState.deleteMany({ where: { stateHash } });
        return reply.code(400).send({ error: 'Provider authorization state expired or was invalid.' });
      }
      const claimed = await fastify.prisma.pluginOAuthState.deleteMany({
        where: { stateHash, providerId: config.id, expiresAt: { gt: new Date() } },
      });
      if (claimed.count !== 1) return reply.code(400).send({ error: 'Provider authorization state was already used.' });
      if (error) {
        await fastify.prisma.pluginAuthorizationEvent.create({
          data: {
            ownerUserId: pending.ownerUserId,
            providerId: config.id,
            eventType: 'authorization_failed',
            actorUserId: pending.ownerUserId,
            details: { reason: 'provider_authorization_denied' },
          },
        });
        return reply.code(400).send({ error: 'Provider authorization was denied.' });
      }
      if (pending.redirectUri !== config.policy.redirectUri) {
        return reply.code(400).send({ error: 'Provider callback configuration changed. Start authorization again.' });
      }

      let exchangedAccessToken: string | null = null;
      try {
        const key = encryptionKey();
        const verifier = decryptProviderCredential(
          pending.encryptedCodeVerifier, key, `oauth-verifier:${config.id}`,
        );
        const tokens = await exchangeAuthorizationCode(config, code!, verifier);
        exchangedAccessToken = tokens.accessToken;
        const encrypted = encryptProviderTokenSet(
          tokens, key, config.id, pending.ownerUserId, pending.requestedScopes, config.policy,
        );
        const unique = { ownerUserId_providerId: { ownerUserId: pending.ownerUserId, providerId: config.id } };
        const existing = await fastify.prisma.pluginProviderConnection.findUnique({ where: unique });
        const refreshCiphertext = encrypted.encryptedRefreshToken ?? existing?.encryptedRefreshToken ?? null;
        if (!refreshCiphertext) throw new Error('Provider did not issue a refresh token.');

        const connection = await fastify.prisma.pluginProviderConnection.upsert({
          where: unique,
          create: {
            ownerUserId: pending.ownerUserId,
            providerId: config.id,
            status: 'connected',
            encryptedAccessToken: encrypted.encryptedAccessToken,
            encryptedRefreshToken: refreshCiphertext,
            accessTokenExpiresAt: encrypted.accessTokenExpiresAt,
            refreshTokenExpiresAt: encrypted.refreshTokenExpiresAt ?? existing?.refreshTokenExpiresAt ?? null,
            grantedScopes: [...encrypted.grantedScopes],
            connectedAt: new Date(),
          },
          update: {
            status: 'connected',
            encryptedAccessToken: encrypted.encryptedAccessToken,
            encryptedRefreshToken: refreshCiphertext,
            accessTokenExpiresAt: encrypted.accessTokenExpiresAt,
            refreshTokenExpiresAt: encrypted.refreshTokenExpiresAt ?? existing?.refreshTokenExpiresAt ?? null,
            grantedScopes: [...encrypted.grantedScopes],
            connectedAt: new Date(),
            revokedAt: null,
            updatedAt: new Date(),
          },
        });
        await fastify.prisma.pluginAuthorizationEvent.create({
          data: {
            ownerUserId: pending.ownerUserId,
            providerId: config.id,
            connectionId: connection.id,
            eventType: existing ? 'connection_reauthorized' : 'authorization_completed',
            actorUserId: pending.ownerUserId,
            details: { grantedScopes: [...encrypted.grantedScopes] },
          },
        });
        const appUrl = requiredEnv('RYANAI_APP_URL');
        if (appUrl) {
          try {
            const destination = new URL('/settings', appUrl);
            const localDevelopment = process.env.NODE_ENV !== 'production' &&
              ['localhost', '127.0.0.1'].includes(destination.hostname);
            if (destination.protocol === 'https:' || (destination.protocol === 'http:' && localDevelopment)) {
              destination.searchParams.set('integration', config.id);
              destination.searchParams.set('status', 'connected');
              return reply.redirect(destination.toString());
            }
          } catch {
            // An invalid app redirect must not turn a completed authorization into a failed one.
          }
        }
        return { connected: true, provider: config.id, grantedScopes: encrypted.grantedScopes };
      } catch {
        if (exchangedAccessToken) await revokeRemoteGrant(config, exchangedAccessToken);
        request.log.warn({ providerId: config.id }, 'Provider OAuth callback did not complete');
        await fastify.prisma.pluginAuthorizationEvent.create({
          data: {
            ownerUserId: pending.ownerUserId,
            providerId: config.id,
            eventType: 'authorization_failed',
            actorUserId: pending.ownerUserId,
            details: { reason: 'provider_authorization_failed' },
          },
        }).catch(() => undefined);
        return reply.code(502).send({ error: 'Provider authorization could not be completed. Reconnect from Settings.' });
      }
    },
  );

  fastify.get('/api/plugins/connections', { preHandler: requireUser }, async (request, reply) => {
    const ownerUserId = request.authUser?.id;
    if (!ownerUserId) return reply.code(401).send({ error: 'Sign in to view provider connections.' });
    const rows = await fastify.prisma.pluginProviderConnection.findMany({
      where: { ownerUserId },
      select: {
        id: true, providerId: true, status: true, displayLabel: true,
        grantedScopes: true, connectedAt: true, revokedAt: true,
        accessTokenExpiresAt: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { connections: rows };
  });

  fastify.post<{ Params: { provider: string } }>(
    '/api/plugins/:provider/disconnect',
    { preHandler: requireUser },
    async (request, reply) => {
      const ownerUserId = request.authUser?.id;
      if (!ownerUserId) return reply.code(401).send({ error: 'Sign in before disconnecting a provider.' });
      const config = providerConfig(request.params.provider);
      if (!config) return reply.code(404).send({ error: 'Provider not found.' });
      const unique = { ownerUserId_providerId: { ownerUserId, providerId: config.id } };
      const connection = await fastify.prisma.pluginProviderConnection.findUnique({ where: unique });
      if (!connection) return { disconnected: true, remoteRevocation: 'not_required' };

      let remoteRevoked = false;
      if (connection.encryptedAccessToken) {
        try {
          const token = decryptProviderCredential(
            connection.encryptedAccessToken, encryptionKey(),
            connectionEncryptionContext(config.id, ownerUserId),
          );
          remoteRevoked = await revokeRemoteGrant(config, token);
        } catch {
          remoteRevoked = false;
        }
      }
      const status = nextProviderRevocationStatus(
        connection.status === 'connected' ? 'connected' : 'reauthorization_required',
        remoteRevoked,
      );
      await fastify.prisma.pluginProviderConnection.update({
        where: unique,
        data: {
          status,
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          revokedAt: remoteRevoked ? new Date() : null,
          updatedAt: new Date(),
        },
      });
      await fastify.prisma.pluginAuthorizationEvent.create({
        data: {
          ownerUserId,
          providerId: config.id,
          connectionId: connection.id,
          eventType: remoteRevoked ? 'revocation_confirmed' : 'revocation_pending',
          actorUserId: ownerUserId,
          details: { remoteRevocation: remoteRevoked ? 'confirmed' : 'not_supported_or_unconfirmed' },
        },
      });
      return {
        disconnected: true,
        localCredentialsPurged: true,
        remoteRevocation: remoteRevoked ? 'confirmed' : 'pending',
      };
    },
  );

  fastify.post<{ Params: { provider: string } }>(
    '/api/plugins/:provider/refresh',
    { preHandler: requireUser },
    async (request, reply) => {
      const ownerUserId = request.authUser?.id;
      if (!ownerUserId) return reply.code(401).send({ error: 'Sign in to refresh a provider connection.' });
      const config = providerConfig(request.params.provider);
      if (!config) return reply.code(404).send({ error: 'Provider not found.' });
      const unique = { ownerUserId_providerId: { ownerUserId, providerId: config.id } };
      const connection = await fastify.prisma.pluginProviderConnection.findUnique({ where: unique });
      if (!connection || connection.status !== 'connected' || !connection.encryptedRefreshToken) {
        return reply.code(409).send({ error: 'Provider connection requires reauthorization.' });
      }
      let requiresReauthorization = false;
      try {
        const key = encryptionKey();
        const refreshToken = decryptProviderCredential(
          connection.encryptedRefreshToken, key,
          `${connectionEncryptionContext(config.id, ownerUserId)}:refresh`,
        );
        const tokens = await refreshProviderToken(config, refreshToken);
        let grantedScopes: readonly string[];
        try {
          grantedScopes = validateProviderGrantedScopes(
            config.policy, config.requestedScopes, tokens.grantedScopes,
          );
        } catch {
          requiresReauthorization = true;
          throw new ProviderOAuthFailure('Provider returned unapproved scopes.', true);
        }
        const encryptedAccess = encryptProviderCredential(
          tokens.accessToken, key, connectionEncryptionContext(config.id, ownerUserId),
        );
        const encryptedRefresh = tokens.refreshToken
          ? encryptProviderCredential(tokens.refreshToken, key, `${connectionEncryptionContext(config.id, ownerUserId)}:refresh`)
          : connection.encryptedRefreshToken;
        const update = await fastify.prisma.pluginProviderConnection.updateMany({
          where: { id: connection.id, encryptedRefreshToken: connection.encryptedRefreshToken, status: 'connected' },
          data: {
            encryptedAccessToken: encryptedAccess,
            encryptedRefreshToken: encryptedRefresh,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? connection.refreshTokenExpiresAt,
            grantedScopes: [...grantedScopes],
            updatedAt: new Date(),
          },
        });
        if (update.count !== 1) return reply.code(409).send({ error: 'Provider token was rotated by another request. Retry status.' });
        await fastify.prisma.pluginAuthorizationEvent.create({
          data: {
            ownerUserId, providerId: config.id, connectionId: connection.id,
            eventType: 'token_refreshed', actorUserId: ownerUserId,
            details: { grantedScopes: [...grantedScopes] },
          },
        });
        return { refreshed: true, provider: config.id, accessTokenExpiresAt: tokens.accessTokenExpiresAt?.toISOString() ?? null };
      } catch (cause) {
        const definitiveInvalidation = requiresReauthorization ||
          (cause instanceof ProviderOAuthFailure && cause.requiresReauthorization);
        if (definitiveInvalidation) {
          await fastify.prisma.pluginProviderConnection.updateMany({
            where: { id: connection.id, status: 'connected' },
            data: { status: 'reauthorization_required', updatedAt: new Date() },
          });
          return reply.code(409).send({ error: 'Provider authorization expired or its granted scopes changed. Reauthorization is required.' });
        }
        request.log.warn({ providerId: config.id }, 'Provider token refresh temporarily failed');
        return reply.code(503).send({ error: 'Provider refresh is temporarily unavailable. The existing connection has been preserved.' });
      }
    },
  );
};
