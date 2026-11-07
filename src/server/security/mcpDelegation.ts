import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const MCP_READ_ONLY_SCOPES = [
  'tool_registry',
  'repository_status',
  'platform_health',
  'ryanai_stack_manifest',
] as const;

export type McpReadOnlyScope = (typeof MCP_READ_ONLY_SCOPES)[number];
export type DelegatedRole = 'user' | 'admin';

interface DelegationClaims {
  iss: 'ryanai-api';
  aud: 'ryanai-mcp';
  sub: string;
  role: DelegatedRole;
  scope: McpReadOnlyScope[];
  iat: number;
  exp: number;
  jti: string;
}

const MAX_TTL_SECONDS = 120;
const DEFAULT_TTL_SECONDS = 60;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

export function hasValidMcpServiceToken(
  suppliedToken: unknown,
  expectedToken: string,
): boolean {
  if (typeof suppliedToken !== 'string' || expectedToken.length < 32) return false;
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function issueMcpDelegationToken(input: {
  subject: string;
  role: DelegatedRole;
  scopes: readonly string[];
  secret: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}): { token: string; expiresAt: number; claims: DelegationClaims } {
  const subject = input.subject.trim();
  if (!subject) throw new Error('A verified subject is required.');
  if (input.secret.length < 32) throw new Error('MCP delegation signing secret is not configured.');
  if (!['user', 'admin'].includes(input.role)) throw new Error('Unsupported delegated role.');
  if (!Array.isArray(input.scopes) || input.scopes.length < 1 || input.scopes.length > MCP_READ_ONLY_SCOPES.length) {
    throw new Error('One or more read-only MCP scopes are required.');
  }

  const scopes = [...new Set(input.scopes)];
  if (scopes.length !== input.scopes.length || scopes.some((scope) => !MCP_READ_ONLY_SCOPES.includes(scope as McpReadOnlyScope))) {
    throw new Error('Requested MCP scope is not allowlisted.');
  }

  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error('MCP delegation lifetime must be between 1 and 120 seconds.');
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const claims: DelegationClaims = {
    iss: 'ryanai-api',
    aud: 'ryanai-mcp',
    sub: subject,
    role: input.role,
    scope: scopes as McpReadOnlyScope[],
    iat: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
  };
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const signingInput = header + '.' + payload;
  const token = signingInput + '.' + signature(signingInput, input.secret).toString('base64url');
  return { token, expiresAt: claims.exp, claims };
}

/** Shared verification contract for the MCP service; no database lookup or side effect. */
export function verifyMcpDelegationToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): DelegationClaims {
  if (secret.length < 32) throw new Error('MCP delegation verification is not configured.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid delegated identity token.');
  const signingInput = parts[0] + '.' + parts[1];
  const expected = signature(signingInput, secret);
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[2], 'base64url');
  } catch {
    throw new Error('Invalid delegated identity signature.');
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('Invalid delegated identity signature.');
  }

  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid delegated identity token payload.');
  }
  if (!header || typeof header !== 'object' || (header as { alg?: string }).alg !== 'HS256' || (header as { typ?: string }).typ !== 'JWT') {
    throw new Error('Unsupported delegated identity token header.');
  }
  if (!claims || typeof claims !== 'object') throw new Error('Invalid delegated identity claims.');
  const value = claims as Partial<DelegationClaims>;
  if (
    value.iss !== 'ryanai-api' || value.aud !== 'ryanai-mcp' ||
    typeof value.sub !== 'string' || !value.sub ||
    !['user', 'admin'].includes(value.role ?? '') ||
    !Array.isArray(value.scope) || value.scope.length < 1 ||
    value.scope.some((scope) => !MCP_READ_ONLY_SCOPES.includes(scope)) ||
    !Number.isInteger(value.iat) || !Number.isInteger(value.exp) ||
    typeof value.jti !== 'string' || !value.jti ||
    (value.exp as number) <= nowSeconds ||
    (value.iat as number) > nowSeconds + 5 ||
    (value.exp as number) - (value.iat as number) > MAX_TTL_SECONDS
  ) {
    throw new Error('Delegated identity claims are invalid or expired.');
  }
  return value as DelegationClaims;
}
