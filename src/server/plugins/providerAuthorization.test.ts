import { describe, expect, it } from 'vitest';
import {
  assertConnectionOwner,
  buildProviderAuthorizationUrl,
  canRevokeProviderConnection,
  constantTimeStateMatch,
  createProviderOAuthTransaction,
  decryptProviderCredential,
  encryptProviderCredential,
  encryptProviderTokenSet,
  nextProviderRevocationStatus,
  readProviderEncryptionKey,
  validateProviderGrantedScopes,
  type ProviderOAuthPolicy,
} from './providerAuthorization.js';

const key = Buffer.alloc(32, 0x5a);
const policy: ProviderOAuthPolicy = {
  providerId: 'google-calendar',
  clientId: 'synthetic-client-id',
  clientSecret: 'never-used-in-client',
  authorizationEndpoint: 'https://accounts.example.test/oauth/authorize',
  tokenEndpoint: 'https://accounts.example.test/oauth/token',
  redirectUri: 'https://api.example.test/api/plugins/oauth/google-calendar/callback',
  allowedScopes: ['calendar.readonly', 'calendar.events'],
  requiredScopes: ['calendar.readonly'],
};

describe('provider authorization security primitives', () => {
  it('accepts only a 32-byte hex encryption key and fails closed when absent', () => {
    expect(readProviderEncryptionKey('5a'.repeat(32))?.length).toBe(32);
    expect(readProviderEncryptionKey(undefined)).toBeNull();
    expect(readProviderEncryptionKey('not-a-key')).toBeNull();
    expect(readProviderEncryptionKey('5a'.repeat(16))).toBeNull();
  });

  it('encrypts credentials with AES-256-GCM, unique nonces and provider/owner AAD', () => {
    const encrypted = encryptProviderCredential('synthetic-access-token', key, 'plugin-token:google-calendar:user-1');
    expect(encrypted).not.toContain('synthetic-access-token');
    expect(encryptProviderCredential('synthetic-access-token', key, 'plugin-token:google-calendar:user-1')).not.toBe(encrypted);
    expect(decryptProviderCredential(encrypted, key, 'plugin-token:google-calendar:user-1')).toBe('synthetic-access-token');
    expect(() => decryptProviderCredential(encrypted, key, 'plugin-token:google-calendar:user-2')).toThrow();
    expect(() => decryptProviderCredential(encrypted.slice(0, -2) + 'aa', key, 'plugin-token:google-calendar:user-1')).toThrow();
    expect(() => encryptProviderCredential('token', Buffer.alloc(16), 'ctx')).toThrow();
  });

  it('creates a short-lived PKCE transaction and stores only a state hash for lookup', () => {
    const now = new Date('2026-11-07T08:00:00.000Z');
    const tx = createProviderOAuthTransaction('google-calendar', key, now);
    expect(tx.state).toHaveLength(43);
    expect(tx.codeVerifier).toHaveLength(43);
    expect(tx.codeChallenge).toHaveLength(43);
    expect(tx.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tx.stateHash).not.toBe(tx.state);
    expect(constantTimeStateMatch(tx.state, tx.stateHash)).toBe(true);
    expect(constantTimeStateMatch('wrong-state', tx.stateHash)).toBe(false);
    expect(decryptProviderCredential(tx.encryptedCodeVerifier, key, 'oauth-verifier:google-calendar')).toBe(tx.codeVerifier);
    expect(tx.expiresAt.getTime() - now.getTime()).toBe(10 * 60 * 1000);
  });

  it('builds HTTPS authorization URLs with exact redirect, state and S256 PKCE', () => {
    const tx = createProviderOAuthTransaction(policy.providerId, key);
    const url = new URL(buildProviderAuthorizationUrl(policy, tx, ['calendar.readonly']));
    expect(url.origin).toBe('https://accounts.example.test');
    expect(url.searchParams.get('client_id')).toBe(policy.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(policy.redirectUri);
    expect(url.searchParams.get('state')).toBe(tx.state);
    expect(url.searchParams.get('code_challenge')).toBe(tx.codeChallenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('calendar.readonly');
    expect(() => buildProviderAuthorizationUrl({ ...policy, redirectUri: 'http://api.example.test/callback' }, tx, ['calendar.readonly'])).toThrow('HTTPS');
    expect(() => buildProviderAuthorizationUrl(policy, tx, ['calendar.admin'])).toThrow('allowlist');
  });

  it('rejects unrequested, disallowed and missing required provider scopes', () => {
    expect(validateProviderGrantedScopes(policy, ['calendar.readonly'], ['calendar.readonly']))
      .toEqual(['calendar.readonly']);
    expect(() => validateProviderGrantedScopes(policy, ['calendar.readonly'], ['calendar.admin']))
      .toThrow('unrequested or disallowed');
    expect(() => validateProviderGrantedScopes(policy, ['calendar.readonly'], []))
      .toThrow('required OAuth scope');
    expect(() => validateProviderGrantedScopes(policy, ['calendar.admin'], ['calendar.admin']))
      .toThrow('not approved');
  });

  it('persists encrypted access and refresh tokens with owner-bound encryption context', () => {
    const result = encryptProviderTokenSet({
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
      grantedScopes: ['calendar.readonly'],
      accessTokenExpiresAt: new Date('2026-11-07T09:00:00Z'),
    }, key, policy.providerId, 'user-1', ['calendar.readonly'], policy);
    expect(result.encryptedAccessToken).not.toContain('synthetic-access');
    expect(result.encryptedRefreshToken).not.toContain('synthetic-refresh');
    expect(decryptProviderCredential(result.encryptedAccessToken, key, 'plugin-token:google-calendar:user-1'))
      .toBe('synthetic-access');
    expect(decryptProviderCredential(result.encryptedRefreshToken!, key, 'plugin-token:google-calendar:user-1:refresh'))
      .toBe('synthetic-refresh');
    expect(result.grantedScopes).toEqual(['calendar.readonly']);
  });

  it('prevents cross-user connection access and tracks provider-confirmed revocation', () => {
    const connection = { ownerUserId: 'user-1', providerId: 'google-calendar' };
    expect(() => assertConnectionOwner(connection, 'user-2', 'google-calendar')).toThrow('not found');
    expect(() => assertConnectionOwner(connection, 'user-1', 'gmail')).toThrow('not found');
    expect(() => assertConnectionOwner(connection, 'user-1', 'google-calendar')).not.toThrow();
    expect(canRevokeProviderConnection('connected')).toBe(true);
    expect(canRevokeProviderConnection('revoked')).toBe(false);
    expect(nextProviderRevocationStatus('connected', false)).toBe('revocation_pending');
    expect(nextProviderRevocationStatus('connected', true)).toBe('revoked');
    expect(() => nextProviderRevocationStatus('revoked', true)).toThrow('cannot be revoked');
  });
});
