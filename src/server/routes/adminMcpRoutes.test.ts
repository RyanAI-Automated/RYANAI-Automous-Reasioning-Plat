import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminMcpRoutes } from './adminMcpRoutes.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function createAdminApp() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { authUser: unknown }).authUser = {
      id: 'admin-id',
      email: 'admin@example.test',
      role: 'admin',
      isOwner: false,
      sessionId: 'admin-session',
    };
  });
  await app.register(adminMcpRoutes);
  return app;
}

describe('governed MCP registry discovery', () => {
  it('fails closed when the MCP endpoint is not configured', async () => {
    vi.stubEnv('MCP_SERVER_URL', '');
    vi.stubEnv('MCP_AUTH_TOKEN', '');
    const app = await createAdminApp();
    const response = await app.inject({ method: 'GET', url: '/api/admin/mcp/registry' });
    expect(response.statusCode).toBe(503);
    expect(response.json().available).toBe(false);
    await app.close();
  });

  it('discovers tools using authenticated read-only JSON-RPC requests', async () => {
    vi.stubEnv('MCP_SERVER_URL', 'https://mcp.example.test/mcp');
    vi.stubEnv('MCP_AUTH_TOKEN', 'ci-only-mcp-auth-token-long-enough-123456');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'health', description: 'Read platform health', inputSchema: { type: 'object' } }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const app = await createAdminApp();
    const response = await app.inject({ method: 'GET', url: '/api/admin/mcp/registry' });
    expect(response.statusCode).toBe(200);
    expect(response.json().available).toBe(true);
    expect(response.json().tools).toEqual([{ name: 'health', description: 'Read platform health', inputSchema: { type: 'object' } }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer ci-only-mcp-auth-token-long-enough-123456' });
    await app.close();
  });
});
