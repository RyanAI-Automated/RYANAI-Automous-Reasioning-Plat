import { FastifyPluginAsync } from 'fastify';
import twilio from 'twilio';
import formbody from '@fastify/formbody';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';
import { claimInboundCommunication, recordCommunication } from '../comms/history.js';
import { getOwnerInboundUserId, storeTwilioMediaForCommunication } from '../comms/attachments.js';
import { addressOwnerResponse, ownerCommunicationInstruction } from '../../shared/ryanIdentity.js';
import { isCommunicationsEnabled } from '../comms/featureFlags.js';

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
  if (!isCommunicationsEnabled()) {
    fastify.log.info('Twilio webhook routes are disabled by configuration.');
    return;
  }
  await fastify.register(formbody);

  fastify.post('/api/webhooks/twilio/whatsapp', {
    preHandler: async (request, reply) => {
      const token = process.env.TWILIO_AUTH_TOKEN?.trim();
      const webhookUrl = process.env.TWILIO_WHATSAPP_WEBHOOK_URL?.trim();
      if (!token || !webhookUrl) return reply.code(503).send({ error: 'Webhook authentication is not configured.' });
      const signature = request.headers['x-twilio-signature'];
      if (typeof signature !== 'string' || !twilio.validateRequest(token, signature, webhookUrl, (request.body || {}) as Record<string, string>)) {
        return reply.code(401).send({ error: 'Invalid Twilio request signature.' });
      }
    },
  }, async (request, reply) => {
    const body = request.body as Record<string, string | undefined>;
    const senderPhone = body.From ? normalizePhone(body.From) : '';
    const incomingText = body.Body?.trim().slice(0, 4000) || '';
    const ownerPhone = process.env.RYANAI_OWNER_PHONE?.trim();
    const rawCount = body.NumMedia ?? '0';
    if (!/^\d+$/.test(rawCount)) return reply.code(400).send({ error: 'Invalid WhatsApp media count.' });
    const mediaCount = Number(rawCount);
    if (!Number.isSafeInteger(mediaCount) || mediaCount < 0 || mediaCount > 8) return reply.code(400).send({ error: 'WhatsApp media count must be between 0 and 8.' });
    const media = Array.from({ length: mediaCount }, (_, index) => ({
      url: body[`MediaUrl${index}`] || '',
      mimeType: body[`MediaContentType${index}`] || '',
      index,
    }));
    if (!senderPhone || !body.MessageSid || (!incomingText && media.length === 0) || media.some(item => !item.url || !item.mimeType)) {
      return reply.code(400).send({ error: 'Invalid Twilio WhatsApp payload.' });
    }
    if (!ownerPhone) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    if (senderPhone !== normalizePhone(ownerPhone)) return reply.code(403).send({ error: 'This WhatsApp assistant is privately configured.' });
    const ownerUserId = getOwnerInboundUserId();
    if (media.length && !ownerUserId) return reply.code(503).send({ error: 'Inbound media storage requires the verified owner Supabase user ID.' });

    const threadId = `whatsapp_${senderPhone.replace(/\D/g, '')}`;
    let mediaStorageFailed = false;
    try {
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'whatsapp',
        externalAddress: senderPhone,
        body: incomingText || `[${media.length} media attachment(s)]`,
        providerMessageId: body.MessageSid,
        status: 'processing',
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(media.length ? { metadata: { mediaCount: media.length } } : {}),
      });
      if (!claim.claimed) {
        const previousReply = claim.existing?.metadata && typeof claim.existing.metadata === 'object'
          && !Array.isArray(claim.existing.metadata) ? (claim.existing.metadata as { reply?: unknown }).reply : undefined;
        reply.type('text/xml');
        if (typeof previousReply === 'string' && previousReply.length) {
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(previousReply)}</Message></Response>`;
        }
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      if (media.length) {
        try { await storeTwilioMediaForCommunication(fastify.prisma, body.MessageSid, media); }
        catch (error) { mediaStorageFailed = true; throw error; }
      }
      const prompt = incomingText
        ? incomingText + (media.length ? `\\n\\nThe sender attached ${media.length} file(s). They have been stored securely but have not been analyzed. Do not claim to have inspected their contents.` : '')
        : `The sender attached ${media.length} file(s). They have been stored securely, but their contents have not been analyzed. Tell Sir they were received without claiming to inspect them.`;
      const result = await humanInTheLoopAgent.invoke({
        messages: [
          { role: 'system', content: ownerCommunicationInstruction() },
          { role: 'user', content: prompt },
        ],
      }, { configurable: { thread_id: threadId } });
      const messages = (result as { messages?: Array<{ content?: unknown }> }).messages ?? [];
      const agentReply = addressOwnerResponse(extractContent(messages.at(-1)?.content) || 'I could not prepare a response.');
      await fastify.prisma.communicationMessage.update({
        where: { providerMessageId: body.MessageSid },
        data: { status: 'replied', metadata: { reply: agentReply, mediaCount: media.length } },
      });
      await recordCommunication(fastify.prisma, {
        channel: 'whatsapp', externalAddress: senderPhone, direction: 'outbound',
        body: agentReply, status: 'response_generated', metadata: { inReplyTo: body.MessageSid },
        ...(ownerUserId ? { ownerUserId } : {}),
      });
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(agentReply.slice(0, 4000))}</Message></Response>`;
    } catch (error) {
      if (mediaStorageFailed) {
        await fastify.prisma.communicationMessage.updateMany({
          where: { providerMessageId: body.MessageSid, status: 'processing' }, data: { status: 'attachment_failed' },
        }).catch((persistenceError) => request.log.error({ err: persistenceError }, 'Unable to persist WhatsApp media retry state'));
        request.log.error({ err: error }, 'WhatsApp media storage failed');
        return reply.code(503).send({ error: 'Inbound media is temporarily unavailable; the provider may retry this webhook.' });
      }
      request.log.error({ err: error }, 'Error processing WhatsApp message');
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>RyanAI is temporarily unavailable. Please try again shortly.</Message></Response>`;
    }
  });
};
