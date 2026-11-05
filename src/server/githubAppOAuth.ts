import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const GITHUB_APP_REPOSITORY = 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat';
export const GITHUB_API_VERSION = '2022-11-28';

export interface GitHubAppConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  returnUrl: string;
  encryptionKey: Buffer;
}

export function readGitHubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig | null {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  const callbackRaw = env.GITHUB_APP_CALLBACK_URL?.trim();
  const returnRaw = env.GITHUB_APP_RETURN_URL?.trim();
  const encryptionRaw = env.GITHUB_TOKEN_ENCRYPTION_KEY?.trim();

  if (!clientId || !clientSecret || !callbackRaw || !returnRaw || !encryptionRaw) return null;
  if (!/^[A-Za-z0-9]+$/.test(clientId) || !/^[0-9a-f]{64}$/i.test(encryptionRaw)) return null;

  try {
    const callback = new URL(callbackRaw);
    const returnUrl = new URL(returnRaw);
    const production = env.NODE_ENV === 'production';
    if ((production && callback.protocol !== 'https:') || (production && returnUrl.protocol !== 'https:')) return null;
    if (!['https:', 'http:'].includes(callback.protocol) || !['https:', 'http:'].includes(returnUrl.protocol)) return null;
    if (callback.username || callback.password || callback.search || callback.hash || callback.pathname !== '/api/github/callback') return null;
    if (returnUrl.username || returnUrl.password || returnUrl.search || returnUrl.hash) return null;
    return {
      clientId,
      clientSecret,
      callbackUrl: callback.toString(),
      returnUrl: returnUrl.toString(),
      encryptionKey: Buffer.from(encryptionRaw, 'hex'),
    };
  } catch {
    return null;
  }
}

export function encryptGitHubSecret(value: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('GitHub token encryption key must contain exactly 32 bytes.');
  if (!value) throw new Error('Cannot encrypt an empty GitHub credential.');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', nonce.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptGitHubSecret(value: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('GitHub token encryption key must contain exactly 32 bytes.');
  const [version, nonceValue, tagValue, ciphertextValue, ...extra] = value.split('.');
  if (version !== 'v1' || !nonceValue || !tagValue || !ciphertextValue || extra.length > 0) {
    throw new Error('Stored GitHub credential has an unsupported encrypted format.');
  }
  const nonce = Buffer.from(nonceValue, 'base64url');
  const tag = Buffer.from(tagValue, 'base64url');
  const ciphertext = Buffer.from(ciphertextValue, 'base64url');
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Stored GitHub credential is malformed.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function createGitHubOAuthState() {
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const stateHash = createHash('sha256').update(state).digest('hex');
  return { state, stateHash, codeVerifier, codeChallenge };
}

export function githubOAuthStateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function buildGitHubAuthorizationUrl(
  config: GitHubAppConfig,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'offline_access');
  url.searchParams.set('allow_signup', 'false');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export function getGitHubReturnUrl(
  config: GitHubAppConfig,
  status: 'connected' | 'denied' | 'error',
): string {
  const target = new URL(config.returnUrl);
  target.searchParams.set('github', status);
  return target.toString();
}

export function parseGitHubTokenTimes(
  payload: Record<string, unknown>,
  now = new Date(),
) {
  const expiresIn = Number.isSafeInteger(payload.expires_in) && Number(payload.expires_in) > 0
    ? Number(payload.expires_in)
    : null;
  const refreshExpiresIn = Number.isSafeInteger(payload.refresh_token_expires_in) && Number(payload.refresh_token_expires_in) > 0
    ? Number(payload.refresh_token_expires_in)
    : null;
  return {
    accessTokenExpiresAt: expiresIn === null ? null : new Date(now.getTime() + expiresIn * 1000),
    refreshTokenExpiresAt: refreshExpiresIn === null ? null : new Date(now.getTime() + refreshExpiresIn * 1000),
  };
}
