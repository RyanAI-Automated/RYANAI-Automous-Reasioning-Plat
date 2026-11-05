import { describe, expect, it } from 'vitest';
import {
  buildGitHubAuthorizationUrl,
  createGitHubOAuthState,
  decryptGitHubSecret,
  encryptGitHubSecret,
  githubOAuthStateHash,
  parseGitHubTokenTimes,
  readGitHubAppConfig,
} from './githubAppOAuth.js';

const key = Buffer.alloc(32, 7);

function environment() {
  return {
    NODE_ENV: 'production',
    GITHUB_APP_CLIENT_ID: 'Iv1.8a61f9b3a7aba766',
    GITHUB_APP_CLIENT_SECRET: 'synthetic-client-secret',
    GITHUB_APP_CALLBACK_URL: 'https://api.example.test/api/github/callback',
    GITHUB_APP_RETURN_URL: 'https://app.example.test/',
    GITHUB_TOKEN_ENCRYPTION_KEY: '07'.repeat(32),
  } as NodeJS.ProcessEnv;
}

describe('GitHub App OAuth security primitives', () => {
  it('fails closed when any required server setting is missing or malformed', () => {
    const env = environment();
    expect(readGitHubAppConfig(env)).not.toBeNull();
    expect(readGitHubAppConfig({ ...env, GITHUB_APP_CLIENT_SECRET: '' })).toBeNull();
    expect(readGitHubAppConfig({ ...env, GITHUB_TOKEN_ENCRYPTION_KEY: 'not-a-key' })).toBeNull();
    expect(readGitHubAppConfig({ ...env, GITHUB_APP_CALLBACK_URL: 'https://api.example.test/callback' })).toBeNull();
    expect(readGitHubAppConfig({ ...env, GITHUB_APP_CALLBACK_URL: 'http://api.example.test/api/github/callback' })).toBeNull();
    expect(readGitHubAppConfig({ ...env, GITHUB_APP_RETURN_URL: 'https://evil.example.test/?redirect=1' })).toBeNull();
  });

  it('encrypts credentials with authenticated AES-GCM and refuses tampering', () => {
    const encrypted = encryptGitHubSecret('ghu.synthetic-token', key);
    expect(encrypted).not.toContain('ghu.synthetic-token');
    expect(encryptGitHubSecret('ghu.synthetic-token', key)).not.toBe(encrypted);
    expect(decryptGitHubSecret(encrypted, key)).toBe('ghu.synthetic-token');
    expect(() => decryptGitHubSecret(encrypted.slice(0, -2) + 'aa', key)).toThrow();
    expect(() => encryptGitHubSecret('token', Buffer.alloc(16))).toThrow();
  });

  it('creates high-entropy state and an S256 PKCE challenge without storing raw state', () => {
    const oauth = createGitHubOAuthState();
    expect(oauth.state).toHaveLength(43);
    expect(oauth.codeVerifier).toHaveLength(43);
    expect(oauth.codeChallenge).toHaveLength(43);
    expect(oauth.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(oauth.stateHash).toBe(githubOAuthStateHash(oauth.state));
    expect(oauth.stateHash).not.toBe(oauth.state);
  });

  it('builds the GitHub authorization URL with exact callback, state and S256', () => {
    const config = readGitHubAppConfig(environment())!;
    const oauth = createGitHubOAuthState();
    const url = new URL(buildGitHubAuthorizationUrl(config, oauth.state, oauth.codeChallenge));
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(config.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(config.callbackUrl);
    expect(url.searchParams.get('state')).toBe(oauth.state);
    expect(url.searchParams.get('code_challenge')).toBe(oauth.codeChallenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('offline_access');
    expect(url.searchParams.get('allow_signup')).toBe('false');
  });

  it('calculates short-lived access and refresh token expiry timestamps', () => {
    const now = new Date('2026-11-05T12:00:00.000Z');
    const times = parseGitHubTokenTimes({ expires_in: 28_800, refresh_token_expires_in: 15_897_600 }, now);
    expect(times.accessTokenExpiresAt?.toISOString()).toBe('2026-11-05T20:00:00.000Z');
    expect(times.refreshTokenExpiresAt?.toISOString()).toBe('2027-05-08T12:00:00.000Z');
    expect(parseGitHubTokenTimes({}, now)).toEqual({ accessTokenExpiresAt: null, refreshTokenExpiresAt: null });
  });
});
