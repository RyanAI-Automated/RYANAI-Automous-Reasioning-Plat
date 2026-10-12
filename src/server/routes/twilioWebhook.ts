import { FastifyPluginAsync } from 'fastify';
import twilio from 'twilio';
import formbody from '@fastify/formbody';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';

const extractContent = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content);

export const twilioWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(formbody);

  fastify.post(
    '/api/webhooks/twilio/whatsapp',
    {
      preHandler: async (request, reply) => {
        const token = process.env.TWILIO_AUTH_TOKEN;
        // Exact externally configured URL; never derive signature input from Host.
        const webhookUrl = process.env.TWILIO_WHATSAPP_WEBHOOK_URL;
        if (!token || !webhookUrl) {
          return reply
            .code(503)
            .send({ error: 'Webhook authentication is not configured.' });
        }
        const signature = request.headers['x-twilio-signature'];
        if (
          typeof signature !== 'string' ||
          !twilio.validateRequest(
            token,
            signature,
            webhookUrl,
            (request.body || {}) as Record<string, string>,
          )
        ) {
          return reply
            .code(401)
            .send({ error: 'Invalid Twilio request signature.' });
        }
      },
    },
    async (request, reply) => {
      const body = request.body as { From?: string; Body?: string };
      const senderPhone = body.From?.replace('whatsapp:', '');
      const incomingText = body.Body;

      if (!senderPhone || !incomingText) {
        reply.status(400);
        return { error: 'Invalid Twilio webhook payload' };
      }

      // Maintain conversation context per user phone number
      const threadId = `whatsapp_${senderPhone.replace('+', '')}`;
      const config = { configurable: { thread_id: threadId } };

      try {
        // Invoke LangGraph agent with the incoming message
        const result = await humanInTheLoopAgent.invoke(
          {
            messages: [{ role: 'user', content: incomingText }],
          },
          config,
        );

        // Safely extract content from the last message in the thread
        const messages =
          (result as { messages?: Array<{ content?: unknown }> }).messages ||
          [];
        const lastMessage = messages.at(-1);
        const agentReply =
          extractContent(lastMessage?.content) ||
          'Request processed successfully.';

        // Return TwiML XML response to Twilio so it replies to the user on WhatsApp
        reply.type('text/xml');
        return `<Response><Message>${escapeXml(agentReply)}</Message></Response>`;
      } catch (err: unknown) {
        fastify.log.error({ err }, 'Error processing WhatsApp webhook message');
        reply.type('text/xml');
        return `<Response><Message>Sorry, an error occurred while processing your request.</Message></Response>`;
      }
    },
  );
};

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}
