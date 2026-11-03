import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { HumanMessage } from '@langchain/core/messages';
import { createChatModel } from '../../config/llm.js';

interface GatewayBody { prompt: string; }
function hasValidGatewayToken(authorization: unknown, expected: string): boolean {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length));
  const known = Buffer.from(expected);
  return supplied.length === known.length && timingSafeEqual(supplied, known);
}

/** Private MCP-to-API gateway. OPENAI_API_KEY remains exclusively in the API process. */
export const internalOpenAiGatewayRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: GatewayBody }>('/api/internal/openai/chat', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', required: ['prompt'], additionalProperties: false,
      properties: { prompt: { type: 'string', minLength: 1, maxLength: 20000 } } } },
  }, async (request, reply) => {
    const expected = process.env.RYANAI_OPENAI_GATEWAY_TOKEN?.trim() ?? '';
    if (expected.length < 32) return reply.code(503).send({ success: false, error: 'Internal model gateway authentication is not configured.' });
    if (!hasValidGatewayToken(request.headers.authorization, expected)) return reply.code(401).send({ success: false, error: 'Unauthorized.' });
    if (!process.env.OPENAI_API_KEY?.trim() && !process.env.OPENAI_BASE_URL?.trim()) return reply.code(503).send({ success: false, error: 'The central model provider is not configured.' });
    const prompt = request.body.prompt.trim();
    if (!prompt) return reply.code(400).send({ success: false, error: 'A non-empty prompt is required.' });
    try {
      const result = await createChatModel().invoke([new HumanMessage(prompt)]);
      const response = typeof result.content === 'string' ? result.content : JSON.stringify(result.content) ?? '';
      if (!response.trim()) return reply.code(502).send({ success: false, error: 'The model provider returned an empty response.' });
      return { success: true, response };
    } catch {
      return reply.code(502).send({ success: false, error: 'The central model provider request failed.' });
    }
  });
};
