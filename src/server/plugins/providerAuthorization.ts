import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const PROVIDER_ID = /^[a-z][a-z0-9-]{1,63}$/;
const SCOPE_PATTERN = /^[A-Za-z0-9._:/-]{1,160}$/;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type ProviderConnectionStatus =
  | 'pending'
  | 'connected'
  | 'reauthorization_required'
  | 'revocation_pending'
  | 'revoked'
  | 'error';

export interface ProviderOAuthPolicy {
  readonly providerId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly redirectUri: string;
  readonly allowedScopes: readonly string[];
  readonly requiredScopes: readonly string[];
}

export interface ProviderOAuthTransaction {
  readonly state: string;
  readonly stateHash: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly encryptedCodeVerifier: string;
  readonly expiresAt: Date;
}

export interface ProviderOAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string | null;
  readonly accessTokenExpiresAt?: Date | null;
  readonly refreshTokenExpiresAt?: Date | null;
  readonly grantedScopes: readonly string[];
}

export interface EncryptedProviderTokenSet {
  readonly encryptedAccessToken: string;
  readonly encryptedRefreshToken: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly refreshTokenExpiresAt: Date | null;
  readonly grantedScopes: readonly string[];
}

export function readProviderEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw.trim())) return null;
  return Buffer.from(raw.trim(), 'hex');
}

export function encryptProviderCredential(value: string, key: Buffer, context: string): string {
  if (key.length !== 32) throw new Error('Provider token encryption key must contain exactly 32 bytes.');
  if (!value || !context) throw new Error('Provider credential and encryption context are required.');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptProviderCredential(value: string, key: Buffer, context: string): string {
  if (key.length !== 32) throw new Error('Provider token encryption key must contain exactly 32 bytes.');
  if (!context) throw new Error('Provider credential encryption context is required.');
  const [version, nonceRaw, tagRaw, ciphertextRaw, ...extra] = value.split('.');
  if (version !== 'v1' || !nonceRaw || !tagRaw || !ciphertextRaw || extra.length) {
    throw new Error('Stored provider credential has an unsupported encrypted format.');
  }
  const nonce = Buffer.from(nonceRaw, 'base64url');
  const tag = Buffer.from(tagRaw, 'base64url');
  const ciphertext = Buffer.from(ciphertextRaw, 'base64url');
  if (nonce.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new Error('Stored provider credential is malformed.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function createProviderOAuthTransaction(
  providerId: string,
  key: Buffer,
  now = new Date(),
): ProviderOAuthTransaction {
  if (!PROVIDER_ID.test(providerId)) throw new Error('Invalid provider identifier.');
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return Object.freeze({
    state,
    stateHash: createHash('sha256').update(state).digest('hex'),
    codeVerifier,
    codeChallenge,
    encryptedCodeVerifier: encryptProviderCredential(codeVerifier, key, `oauth-verifier:${providerId}`),
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
  });
}

export function hashProviderOAuthState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function constantTimeStateMatch(candidate: string, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const candidateHash = Buffer.from(hashProviderOAuthState(candidate), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return candidateHash.length === expected.length && timingSafeEqual(candidateHash, expected);
}

function normalizeScopeList(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

export function validateProviderGrantedScopes(
  policy: Pick<ProviderOAuthPolicy, 'allowedScopes' | 'requiredScopes'>,
  requestedScopes: readonly string[],
  grantedScopes: readonly string[],
): readonly string[] {
  const allowed = new Set(normalizeScopeList(policy.allowedScopes));
  const required = new Set(normalizeScopeList(policy.requiredScopes));
  const requested = new Set(normalizeScopeList(requestedScopes));
  const granted = new Set(normalizeScopeList(grantedScopes));

  for (const scope of [...allowed, ...required, ...requested, ...granted]) {
    if (!SCOPE_PATTERN.test(scope)) throw new Error('Provider returned an invalid OAuth scope.');
  }
  for (const scope of requested) {
    if (!allowed.has(scope)) throw new Error(`OAuth scope is not approved for this provider: ${scope}`);
  }
  for (const scope of granted) {
    if (!requested.has(scope) || !allowed.has(scope)) {
      throw new Error(`Provider granted an unrequested or disallowed OAuth scope: ${scope}`);
    }
  }
  for (const scope of required) {
    if (!granted.has(scope)) throw new Error(`Provider did not grant required OAuth scope: ${scope}`);
  }
  return Object.freeze([...granted].sort());
}

export function buildProviderAuthorizationUrl(
  policy: ProviderOAuthPolicy,
  transaction: Pick<ProviderOAuthTransaction, 'state' | 'codeChallenge'>,
  requestedScopes: readonly string[],
): string {
  if (!PROVIDER_ID.test(policy.providerId)) throw new Error('Invalid provider identifier.');
  const authorizationEndpoint = new URL(policy.authorizationEndpoint);
  const tokenEndpoint = new URL(policy.tokenEndpoint);
  const redirectUri = new URL(policy.redirectUri);
  if (!policy.clientId.trim() || authorizationEndpoint.protocol !== 'https:' ||
      tokenEndpoint.protocol !== 'https:' || redirectUri.protocol !== 'https:') {
    throw new Error('Provider OAuth endpoints and redirect URI must use HTTPS.');
  }
  if (authorizationEndpoint.username || authorizationEndpoint.password || authorizationEndpoint.hash ||
      redirectUri.username || redirectUri.password || redirectUri.hash) {
    throw new Error('Provider OAuth URLs must not contain credentials or fragments.');
  }
  const allowed = new Set(normalizeScopeList(policy.allowedScopes));
  const scopes = normalizeScopeList(requestedScopes);
  const required = new Set(normalizeScopeList(policy.requiredScopes));
  if (!scopes.length || scopes.some((scope) => !allowed.has(scope) || !SCOPE_PATTERN.test(scope)) ||
      [...required].some((scope) => !scopes.includes(scope))) {
    throw new Error('Requested OAuth scopes exceed the provider allowlist or omit a required scope.');
  }
  if (!transaction.state || !transaction.codeChallenge) throw new Error('OAuth state and PKCE challenge are required.');

  authorizationEndpoint.searchParams.set('response_type', 'code');
  authorizationEndpoint.searchParams.set('client_id', policy.clientId);
  authorizationEndpoint.searchParams.set('redirect_uri', redirectUri.toString());
  authorizationEndpoint.searchParams.set('state', transaction.state);
  authorizationEndpoint.searchParams.set('code_challenge', transaction.codeChallenge);
  authorizationEndpoint.searchParams.set('code_challenge_method', 'S256');
  authorizationEndpoint.searchParams.set('scope', scopes.join(' '));
  return authorizationEndpoint.toString();
}

export function encryptProviderTokenSet(
  tokens: ProviderOAuthTokenSet,
  key: Buffer,
  providerId: string,
  ownerUserId: string,
  requestedScopes: readonly string[],
  policy: Pick<ProviderOAuthPolicy, 'allowedScopes' | 'requiredScopes'>,
): EncryptedProviderTokenSet {
  if (!PROVIDER_ID.test(providerId) || !ownerUserId.trim()) throw new Error('Provider and owner identity are required.');
  if (!tokens.accessToken) throw new Error('Provider access token is required.');
  const grantedScopes = validateProviderGrantedScopes(policy, requestedScopes, tokens.grantedScopes);
  const context = `plugin-token:${providerId}:${ownerUserId}`;
  return Object.freeze({
    encryptedAccessToken: encryptProviderCredential(tokens.accessToken, key, context),
    encryptedRefreshToken: tokens.refreshToken
      ? encryptProviderCredential(tokens.refreshToken, key, `${context}:refresh`)
      : null,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
    grantedScopes,
  });
}

export function assertConnectionOwner(
  connection: { ownerUserId: string; providerId: string },
  actorUserId: string,
  providerId: string,
): void {
  if (!actorUserId || connection.ownerUserId !== actorUserId || connection.providerId !== providerId) {
    throw new Error('Provider connection not found.');
  }
}

export function canRevokeProviderConnection(status: ProviderConnectionStatus): boolean {
  return status === 'connected' || status === 'reauthorization_required' || status === 'error';
}

export function nextProviderRevocationStatus(
  status: ProviderConnectionStatus,
  providerRevocationConfirmed: boolean,
): ProviderConnectionStatus {
  if (!canRevokeProviderConnection(status)) {
    throw new Error(`Provider connection cannot be revoked from status ${status}.`);
  }
  return providerRevocationConfirmed ? 'revoked' : 'revocation_pending';
}
