import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { getUser, createContextClient } = vi.hoisted(() => ({ getUser: vi.fn(), createContextClient: vi.fn() }));
vi.mock('@supabase/server/core', () => ({ createContextClient }));

import { mcpDelegationRoutes } from './mcpDelegation.js';
import { verifyMcpDelegationToken } from '../security/mcpDelegation.js';

const serviceToken = 'mcp-service-test-token-with-at-least-32-bytes';
const signingSecret = 'mcp-signing-test-secret-with-at-least-32-bytes';

describe('API MCP delegation endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.test');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    vi.stubEnv('RYANAI_MCP_SERVICE_TOKEN', serviceToken);
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', signingSecret);
    vi.stubEnv('NODE_ENV', 'test');
    createContextClient.mockReturnValue({ auth: { getUser } });
    getUser.mockResolvedValue({
      data: { user: { id: 'verified-user-id', email: 'member@example.test', app_metadata: {}, user_metadata: {}, is_anonymous: false } },
      error: null,
    });
    app = Fastify();
    await app.register(mcpDelegationRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('requires MCP service authentication and a verified Supabase user', async () => {
    const noService = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['tool_registry'] },
    });
    expect(noService.statusCode).toBe(401);
    expect(getUser).not.toHaveBeenCalled();

    const noUser = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken },
      payload: { scopes: ['tool_registry'] },
    });
    expect(noUser.statusCode).toBe(401);
  });

  it('issues a verified, Gen-X-allowed, narrow-scope token', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['tool_registry', 'platform_health'] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const claims = verifyMcpDelegationToken(body.token, signingSecret);
    expect(claims.sub).toBe('verified-user-id');
    expect(claims.scope).toEqual(['tool_registry', 'platform_health']);
    expect(body.audience).toBe('ryanai-mcp');
    expect(body.tokenType).toBe('Bearer');
  });

  it('rejects unapproved scopes before issuing a token', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['shell'] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('fails closed when the signing secret is absent', async () => {
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', '');
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['tool_registry'] },
    });
    expect(response.statusCode).toBe(503);
  });
});
