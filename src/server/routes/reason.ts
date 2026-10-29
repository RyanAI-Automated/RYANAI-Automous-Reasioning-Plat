import { FastifyPluginAsync } from 'fastify';
import { invokeReasoningAgent } from '../../agent/invoke.js';

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
      const result = await invokeReasoningAgent({
        prompt,
        model: request.body?.model,
        user: request.authUser,
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
      fastify.log.error({ err }, 'Reasoning request failed');
      return reply.code(502).send({
        success: false,
        error: 'Reasoning provider request failed. Please try again later.',
      });
    }
  });
};