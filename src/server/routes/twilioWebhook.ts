import { FastifyPluginAsync } from 'fastify';
import twilio from 'twilio';
import formbody from '@fastify/formbody';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';
import { recordCommunication } from '../comms/history.js';
import { addressOwnerMessage, communicationSystemInstruction } from '../comms/personalization.js';

const extractContent = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content) ?? '';

function normalizePhone(value: string): string {
  return value.replace(/^whatsapp:/i, '').replace(/[^+\d]/g, '');
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[c] ?? c);
}

export const twilioWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(formbody);

  fastify.post('/api/webhooks/twilio/whatsapp', {
    preHandler: async (request, reply) => {
      const token = process.env.TWILIO_AUTH_TOKEN?.trim();
      const webhookUrl = process.env.TWILIO_WHATSAPP_WEBHOOK_URL?.trim();
      if (!token || !webhookUrl) {
        return reply.code(503).send({ error: 'Webhook authentication is not configured.' });
      }
      const signature = request.headers['x-twilio-signature'];
      if (typeof signature !== 'string' || !twilio.validateRequest(
        token, signature, webhookUrl, (request.body || {}) as Record<string, string>,
      )) {
        return reply.code(401).send({ error: 'Invalid Twilio request signature.' });
      }
    },
  }, async (request, reply) => {
    const body = request.body as { From?: string; Body?: string; MessageSid?: string };
    const senderPhone = body.From ? normalizePhone(body.From) : '';
    const incomingText = body.Body?.trim().slice(0, 4000);
    const ownerPhone = process.env.RYANAI_OWNER_PHONE?.trim();

    if (!senderPhone || !incomingText || !body.MessageSid) {
      return reply.code(400).send({ error: 'Invalid Twilio WhatsApp payload.' });
    }
    if (!ownerPhone) {
      return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    }
    if (senderPhone !== normalizePhone(ownerPhone)) {
      request.log.warn({ senderPhone }, 'Rejected WhatsApp message from non-owner sender');
      return reply.code(403).send({ error: 'This WhatsApp assistant is privately configured.' });
    }

    const threadId = `whatsapp_${senderPhone.replace(/\D/g, '')}`;
    try {
      const previous = await fastify.prisma.communicationMessage.findUnique({
        where: { providerMessageId: body.MessageSid },
      });
      const previousReply = previous?.metadata && typeof previous.metadata === 'object'
        ? (previous.metadata as { reply?: unknown }).reply
        : undefined;
      if (typeof previousReply === 'string' && previousReply.length) {
        reply.type('text/xml');
        return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(previousReply)}</Message></Response>`;
      }

      await recordCommunication(fastify.prisma, {
        channel: 'whatsapp',
        externalAddress: senderPhone,
        direction: 'inbound',
        body: incomingText,
        providerMessageId: body.MessageSid,
        status: 'processing',
      });

      const result = await humanInTheLoopAgent.invoke(
        { messages: [{ role: 'system', content: communicationSystemInstruction() }, { role: 'user', content: incomingText }] },
        { configurable: { thread_id: threadId } },
      );
      const messages = (result as { messages?: Array<{ content?: unknown }> }).messages ?? [];
      const agentReply = addressOwnerMessage(extractContent(messages.at(-1)?.content) || 'I could not prepare a response.');
      await fastify.prisma.communicationMessage.update({
        where: { providerMessageId: body.MessageSid },
        data: { status: 'replied', metadata: { reply: agentReply } },
      });
      await recordCommunication(fastify.prisma, {
        channel: 'whatsapp',
        externalAddress: senderPhone,
        direction: 'outbound',
        body: agentReply,
        status: 'response_generated',
        metadata: { inReplyTo: body.MessageSid },
      });

      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(agentReply.slice(0, 4000))}</Message></Response>`;
    } catch (error) {
      request.log.error({ err: error }, 'Error processing WhatsApp message');
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>RyanAI is temporarily unavailable. Please try again shortly.</Message></Response>`;
    }
  });
};
