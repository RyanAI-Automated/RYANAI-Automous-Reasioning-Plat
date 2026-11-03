import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../config/llm.js', () => ({ createChatModel: () => ({ invoke }) }));
import { internalOpenAiGatewayRoutes } from './internalOpenAi.js';

describe('private OpenAI gateway', () => {
  afterEach(() => { vi.unstubAllEnvs(); invoke.mockReset(); });
  async function makeApp() { const server = Fastify(); await server.register(internalOpenAiGatewayRoutes); return server; }
  it('rejects unauthenticated MCP requests before invoking the model', async () => {
    vi.stubEnv('RYANAI_OPENAI_GATEWAY_TOKEN', 'a'.repeat(40)); vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await makeApp();
    const response = await server.inject({ method: 'POST', url: '/api/internal/openai/chat', payload: { prompt: 'Hello' } });
    expect(response.statusCode).toBe(401); expect(invoke).not.toHaveBeenCalled(); await server.close();
  });
  it('fails closed when the internal service token is missing', async () => {
    vi.stubEnv('RYANAI_OPENAI_GATEWAY_TOKEN', '');
    const server = await makeApp();
    const response = await server.inject({ method: 'POST', url: '/api/internal/openai/chat', headers: { authorization: 'Bearer ' + 'a'.repeat(40) }, payload: { prompt: 'Hello' } });
    expect(response.statusCode).toBe(503); await server.close();
  });
  it('uses the API-owned central model after service authentication', async () => {
    vi.stubEnv('RYANAI_OPENAI_GATEWAY_TOKEN', 'a'.repeat(40)); vi.stubEnv('OPENAI_API_KEY', 'test-key');
    invoke.mockResolvedValue({ content: 'RyanAI ready' });
    const server = await makeApp();
    const response = await server.inject({ method: 'POST', url: '/api/internal/openai/chat', headers: { authorization: 'Bearer ' + 'a'.repeat(40) }, payload: { prompt: 'Hello' } });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ success: true, response: 'RyanAI ready' });
    expect(invoke).toHaveBeenCalledTimes(1); await server.close();
  });
  it('rejects blank prompts and hides provider diagnostics', async () => {
    vi.stubEnv('RYANAI_OPENAI_GATEWAY_TOKEN', 'a'.repeat(40)); vi.stubEnv('OPENAI_API_KEY', 'test-key');
    invoke.mockRejectedValue(new Error('secret-bearing provider diagnostic'));
    const server = await makeApp(); const headers = { authorization: 'Bearer ' + 'a'.repeat(40) };
    const invalid = await server.inject({ method: 'POST', url: '/api/internal/openai/chat', headers, payload: { prompt: '   ' } });
    expect(invalid.statusCode).toBe(400);
    const failed = await server.inject({ method: 'POST', url: '/api/internal/openai/chat', headers, payload: { prompt: 'Hello' } });
    expect(failed.statusCode).toBe(502); expect(failed.body).not.toContain('secret-bearing'); await server.close();
  });
});
