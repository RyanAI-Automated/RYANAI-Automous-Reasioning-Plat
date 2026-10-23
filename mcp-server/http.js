import { timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './index.js';

const host = process.env.MCP_HOST || '127.0.0.1';
const port = Number(process.env.MCP_PORT || 8765);
const token = process.env.MCP_AUTH_TOKEN || '';
const allowedHosts = new Set(
  (process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1]')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MCP_PORT must be an integer between 1 and 65535.');
}

if (!['127.0.0.1', '::1', 'localhost'].includes(host) && token.length < 32) {
  throw new Error('MCP_AUTH_TOKEN must contain at least 32 characters when MCP_HOST is not loopback.');
}

const httpServer = createHttpServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://localhost');

  if (requestUrl.pathname === '/health' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok', service: 'ryanai-mcp-manager', transport: 'streamable-http' }));
    return;
  }

  if (requestUrl.pathname !== '/mcp') {
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let hostHeader;
  try {
    hostHeader = new URL(`http://${request.headers.host || ''}`).hostname.toLowerCase();
  } catch {
    hostHeader = '';
  }
  if (!allowedHosts.has(hostHeader)) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Host is not allowed' }));
    return;
  }

  if (token && !hasValidToken(request.headers.authorization, token)) {
    response.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Bearer' });
    response.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const origin = request.headers.origin;
  if (typeof origin === 'string') {
    let originHost;
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch {
      originHost = '';
    }
    if (!allowedHosts.has(originHost)) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Origin is not allowed' }));
      return;
    }
  }

  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Only POST is supported by the stateless MCP endpoint' }));
    return;
  }

  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > 1024 * 1024) {
    response.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Request body is too large' }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    console.error('MCP HTTP request failed:', error instanceof Error ? error.message : String(error));
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'MCP request failed' }));
    }
  } finally {
    await server.close().catch((error) => {
      console.error('Could not close MCP request server:', error instanceof Error ? error.message : String(error));
    });
  }
});

httpServer.requestTimeout = 120_000;
httpServer.headersTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;

httpServer.listen(port, host, () => {
  console.error(`RyanAI MCP Manager listening at http://${host}:${port}/mcp`);
});

async function shutdown(signal) {
  console.error(`Received ${signal}; closing RyanAI MCP Manager.`);
  httpServer.close((error) => {
    if (error) {
      console.error('MCP HTTP server shutdown failed:', error.message);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

function hasValidToken(authorization, expectedToken) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
