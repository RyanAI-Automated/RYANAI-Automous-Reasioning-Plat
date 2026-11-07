import { describe, expect, it } from 'vitest';
import {
  hasValidMcpServiceToken,
  issueMcpDelegationToken,
  verifyMcpDelegationToken,
} from './mcpDelegation.js';

const secret = 'test-only-delegation-signing-secret-32';
const scopes = ['tool_registry', 'platform_health'] as const;

describe('API-issued MCP delegated identity', () => {
  it('issues a short-lived audience-bound identity with only requested scopes', () => {
    const issued = issueMcpDelegationToken({ subject: 'supabase-user-123', role: 'user', scopes, secret, nowSeconds: 1_800_000_000, ttlSeconds: 60 });
    const verified = verifyMcpDelegationToken(issued.token, secret, 1_800_000_030);
    expect(verified).toMatchObject({ iss: 'ryanai-api', aud: 'ryanai-mcp', sub: 'supabase-user-123', role: 'user', scope: scopes, iat: 1_800_000_000, exp: 1_800_000_060 });
    expect(issued.expiresAt).toBe(1_800_000_060);
  });
  it('rejects expired tokens and signatures from another service secret', () => {
    const issued = issueMcpDelegationToken({ subject: 'supabase-user-123', role: 'admin', scopes, secret, nowSeconds: 100 });
    expect(() => verifyMcpDelegationToken(issued.token, secret, 161)).toThrow(/expired/);
    expect(() => verifyMcpDelegationToken(issued.token, 'another-test-secret-with-32-bytes', 101)).toThrow(/signature/);
  });
  it('rejects unknown scopes and excessive token lifetimes', () => {
    expect(() => issueMcpDelegationToken({ subject: 'user', role: 'user', scopes: ['shell'], secret })).toThrow(/not allowlisted/);
    expect(() => issueMcpDelegationToken({ subject: 'user', role: 'user', scopes, secret, ttlSeconds: 300 })).toThrow(/between 1 and 120/);
  });
  it('compares service credentials without timing-sensitive string equality', () => {
    expect(hasValidMcpServiceToken('service-token-value-123456789012', 'service-token-value-123456789012')).toBe(true);
    expect(hasValidMcpServiceToken('wrong-service-token-value-123456789', 'service-token-value-123456789012')).toBe(false);
    expect(hasValidMcpServiceToken(undefined, 'service-token-value-123456789012')).toBe(false);
  });
});
