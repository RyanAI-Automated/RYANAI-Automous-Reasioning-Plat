import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from './auth.js';

type JsonRpcResult = { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }; error?: { message?: string } };

function parseRpcBody(body: string, contentType: string): JsonRpcResult {
  if (contentType.includes('text/event-stream')) {
    const data = body.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
    const payload = data.map((line) => { try { return JSON.parse(line) as JsonRpcResult; } catch { return null; } }).filter((item): item is JsonRpcResult => Boolean(item));
    const result = payload.find((item) => item.result || item.error);
    if (result) return result;
  }
  return JSON.parse(body) as JsonRpcResult;
}

export const adminMcpRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/admin/mcp/registry', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    const configured = process.env.MCP_SERVER_URL?.trim();
    if (!configured) return reply.code(503).send({ available: false, error: 'MCP_SERVER_URL is not configured on the API server.' });

    let endpoint: URL;
    try {
      endpoint = new URL(configured);
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('URL must not contain credentials, query parameters or fragments.');
      if (endpoint.pathname !== '/mcp') throw new Error('MCP_SERVER_URL must point to the /mcp endpoint.');
      if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
        throw new Error('Remote MCP endpoints must use HTTPS.');
      }
    } catch (error) {
      return reply.code(503).send({ available: false, error: error instanceof Error ? error.message : 'MCP endpoint configuration is invalid.' });
    }

    const token = process.env.MCP_AUTH_TOKEN?.trim();
    if (endpoint.protocol === 'https:' && (!token || token.length < 32)) {
      return reply.code(503).send({ available: false, error: 'A 32-character MCP_AUTH_TOKEN is required for remote MCP access.' });
    }

    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-03-26',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    };
    const sendRpc = async (id: number, method: string, params: Record<string, unknown>) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      const body = await response.text();
      if (!response.ok) throw new Error('MCP endpoint returned HTTP ' + response.status + '.');
      const payload = parseRpcBody(body, response.headers.get('content-type') || '');
      if (payload.error) throw new Error(payload.error.message || 'MCP JSON-RPC request failed.');
      return payload;
    };

    try {
      await sendRpc(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'ryanai-admin-registry', version: '1.0.0' },
      });
      const result = await sendRpc(2, 'tools/list', {});
      const tools = result.result?.tools;
      if (!Array.isArray(tools)) throw new Error('MCP endpoint returned no valid tools list.');
      return {
        available: true,
        discoveredAt: new Date().toISOString(),
        transport: 'streamable-http',
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema ?? {},
        })),
        note: 'Live tools discovered from the configured MCP runtime. This endpoint is read-only; allowlist changes remain a separate reviewed operator action.',
      };
    } catch (error) {
      requestLogError(fastify, error);
      return reply.code(502).send({ available: false, error: 'Live MCP discovery failed. Check server reachability, host allowlist, protocol compatibility and authentication.' });
    }
  });
};

function requestLogError(fastify: Parameters<FastifyPluginAsync>[0], error: unknown) {
  fastify.log.warn({ err: error instanceof Error ? error.message : 'unknown MCP registry error' }, 'Live MCP registry discovery failed');
}
