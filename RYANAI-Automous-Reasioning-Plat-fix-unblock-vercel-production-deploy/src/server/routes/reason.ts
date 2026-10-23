import { FastifyPluginAsync } from 'fastify';
import { getReasoningAgent } from '../../agent/engine.js';

/**
 * Register a reasoning endpoint returning the final output and full message trace.
 * Blank prompts return HTTP 400; model selection and invocation errors become 500 results.
 */
export const reasonPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: { prompt?: string; model?: string } }>('/api/reason', async (request, reply) => {
    const prompt = request.body?.prompt?.trim();
    if (!prompt) {
      return reply.code(400).send({ success: false, error: 'A non-empty prompt is required' });
    }

    try {
      const result = await getReasoningAgent(request.body?.model).invoke({
        messages: [{ role: 'user', content: prompt }],
      });

      const lastMessage = result.messages[result.messages.length - 1];
      const output = typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? '');
      const reasoningTrace = result.messages.map((message: { content: unknown }) =>
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content) ?? ''
      );

      return {
        success: true,
        objective: prompt,
        output: output ?? '',
        reasoningTrace,
        engine: 'RyanAI LangGraph ReAct',
        response: output ?? '',
        trace: reasoningTrace,
        timestamp: new Date().toISOString(),
      };
    } catch (err: unknown) {
      reply.status(500);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    }
  });
};