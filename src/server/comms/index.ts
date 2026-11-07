import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import formbody from '@fastify/formbody';
import rawBody from 'fastify-raw-body';
import { Resend } from 'resend';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';
import { beginOutboundCommunication, claimInboundCommunication, completeOutboundCommunication, markOutboundCommunicationUnknown, OutboundIdempotencyConflictError, prepareOutboundCommunication, recordCommunication, updateCommunicationStatus } from './history.js';
import { addressOwnerMessage, getOwnerGreeting } from './personalization.js';
import { createCommsUploadIntents, createCommsStorageAdmin, cleanCommsAttachmentUrls, downloadCleanCommsAttachments, downloadResendMedia, getCommsAttachmentScanStates, getCommsAttachmentStatuses, getOwnerInboundUserId, storeInboundCommsAttachment, storeTwilioMediaForCommunication } from './attachments.js';
import { addressOwnerResponse, ownerCommunicationInstruction, RYANAI_LOCALE } from '../../shared/ryanIdentity.js';
import { areCommunicationAttachmentsEnabled, isCommunicationsEnabled } from './featureFlags.js';
import { createCommsDispatchApprovalDigest } from './dispatchApproval.js';

type Channel = 'whatsapp' | 'sms' | 'voice' | 'email';
type CommsBody = { channel?: Channel; recipient?: string; message?: string; subject?: string; contentSid?: string; contentVariables?: string; idempotencyKey?: string; attachmentIds?: string[]; approvalId?: string };
const MAX_MESSAGE_LENGTH = 4000;
const E164 = /^\+[1-9]\d{7,14}$/;

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[char] ?? char);
}
function normalizePhone(value: string): string {
  return value.replace(/^whatsapp:/i, '').replace(/[^+\d]/g, '');
}
function emailAddress(value: string): string {
  const match = value.match(/<([^<>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}
function twilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  return sid && token ? twilio(sid, token) : null;
}
function webhookAuth(urlEnv: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const url = process.env[urlEnv]?.trim();
    const signature = request.headers['x-twilio-signature'];
    if (!token || !url) return reply.code(503).send({ error: 'Twilio webhook authentication is not configured.' });
    if (typeof signature !== 'string' || !twilio.validateRequest(
      token, signature, url, (request.body || {}) as Record<string, string>,
    )) return reply.code(401).send({ error: 'Invalid Twilio request signature.' });
  };
}
function twimlSay(message: string, gather = true): string {
  const action = process.env.TWILIO_VOICE_ACTION_URL?.trim();
  const voice = escapeXml(process.env.RYANAI_TWILIO_VOICE?.trim() || 'Polly.Ayanda-Neural');
  const say = (value: string) => `<Say language="${RYANAI_LOCALE}" voice="${voice}">${escapeXml(value)}</Say>`;
  if (!action || !gather) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(message)}<Hangup/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(message)}<Gather input="speech" language="${RYANAI_LOCALE}" action="${escapeXml(action)}" method="POST" speechTimeout="auto" timeout="5">${say('Please speak after the tone.')}</Gather>${say('I did not hear a response. Goodbye.')}<Hangup/></Response>`;
}

async function askRyanAI(text: string, threadId: string): Promise<string> {
  const result = await humanInTheLoopAgent.invoke(
    {
      messages: [
        { role: 'system', content: ownerCommunicationInstruction() },
        { role: 'user', content: text },
      ],
    },
    { configurable: { thread_id: threadId } },
  );
  const messages = (result as { messages?: Array<{ content?: unknown }> }).messages ?? [];
  const content = messages.at(-1)?.content;
  return typeof content === 'string' ? content : JSON.stringify(content) ?? 'I could not prepare a response.';
}

function parseTwilioMedia(body: Record<string, string | undefined>) {
  const rawCount = body.NumMedia ?? '0';
  if (!/^\d+$/.test(rawCount)) throw new Error('Invalid Twilio media count.');
  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0 || count > 8) throw new Error('Twilio media count must be between 0 and 8.');
  return Array.from({ length: count }, (_, index) => {
    const url = body[`MediaUrl${index}`];
    const mimeType = body[`MediaContentType${index}`];
    if (!url || !mimeType) throw new Error('Twilio media payload is incomplete.');
    return { url, mimeType, index };
  });
}

function smtpTransport() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !user || !pass || !from) return null;
  return {
    from,
    transporter: nodemailer.createTransport({
      host, port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    }),
  };
}

/** Real provider-backed channels. Twilio and Resend webhooks are signature verified. */
export const commsPlugin: FastifyPluginAsync = async (fastify) => {
  if (!isCommunicationsEnabled()) {
    fastify.log.info('Communications routes are disabled by configuration.');
    return;
  }
  await fastify.register(formbody);
  await fastify.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true });


  fastify.post<{ Body: { channel?: Channel; recipient?: string; message?: string; subject?: string; idempotencyKey?: string; files?: Array<{ name: string; mimeType: string; size: number }> } }>('/api/comms/attachments/prepare', async (request, reply) => {
    if (!areCommunicationAttachmentsEnabled()) return reply.code(503).send({ error: 'Communication attachments are disabled.' });
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required.' });
    const { channel, recipient, message, subject, idempotencyKey, files } = request.body ?? {};
    if (!channel || !['whatsapp', 'sms', 'email'].includes(channel)) return reply.code(400).send({ error: 'Attachments are supported for WhatsApp, SMS and email.' });
    const targetValue = recipient || (channel === 'email' ? process.env.RYANAI_OWNER_EMAIL : process.env.RYANAI_OWNER_PHONE);
    const target = typeof targetValue === 'string' ? targetValue.trim() : '';
    const bodyText = typeof message === 'string' ? message.trim() : '';
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!target || !bodyText || bodyText.length > MAX_MESSAGE_LENGTH) return reply.code(400).send({ error: 'A recipient and message of at most 4,000 characters are required.' });
    if (!key || key.length < 16 || key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key)) return reply.code(400).send({ error: 'A valid 16–128 character idempotency key is required.' });
    if (channel === 'email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) : !E164.test(target)) return reply.code(400).send({ error: 'Recipient address is invalid.' });
    if (!Array.isArray(files)) return reply.code(400).send({ error: 'An attachment file list is required.' });
    try {
      const ownerRecipient = channel === 'email'
        ? target.toLowerCase() === process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase()
        : Boolean(process.env.RYANAI_OWNER_PHONE && normalizePhone(target) === normalizePhone(process.env.RYANAI_OWNER_PHONE));
      const prepared = await prepareOutboundCommunication(fastify.prisma, {
        channel,
        externalAddress: channel === 'email' ? target.toLowerCase() : target,
        body: ownerRecipient ? addressOwnerMessage(bodyText) : bodyText,
        idempotencyKey: key,
        ownerUserId: request.authUser.id,
        ...(channel === 'email' ? { metadata: { subject: typeof subject === 'string' && subject.trim() ? subject.trim() : 'RyanAI notification' } } : {}),
      });
      const uploads = await createCommsUploadIntents(fastify.prisma, request.authUser.id, prepared.id, files);
      return reply.code(prepared.replayed ? 200 : 201).send({ success: true, messageId: prepared.id, replayed: prepared.replayed, attachments: uploads });
    } catch (error) {
      request.log.warn({ err: error }, 'Comms attachment preparation rejected');
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to prepare attachment uploads.' });
    }
  });

  fastify.get<{ Querystring: { ids?: string } }>('/api/comms/attachments/status', async (request, reply) => {
    if (!areCommunicationAttachmentsEnabled()) return reply.code(503).send({ error: 'Communication attachments are disabled.' });
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required.' });
    const ids = (request.query.ids || '').split(',').filter(Boolean);
    if (!ids.length || ids.length > 8 || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) return reply.code(400).send({ error: 'Provide 1–8 valid attachment IDs.' });
    try {
      const attachments = await getCommsAttachmentStatuses(fastify.prisma, request.authUser.id, ids);
      return { attachments };
    } catch {
      return reply.code(404).send({ error: 'One or more attachments were not found for this owner.' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/comms/attachments/:id/download', async (request, reply) => {
    if (!areCommunicationAttachmentsEnabled()) return reply.code(503).send({ error: 'Communication attachments are disabled.' });
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required.' });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(400).send({ error: 'Invalid attachment ID.' });
    try {
      const urls = await cleanCommsAttachmentUrls(fastify.prisma, request.authUser.id, [request.params.id], 60);
      return { url: urls.get(request.params.id) };
    } catch {
      return reply.code(404).send({ error: 'Attachment is not available until its security scan is clean.' });
    }
  });

  fastify.post<{ Body: { operation?: 'summarize' | 'draft' | 'translate' | 'extract_tasks'; conversationId?: string; language?: string; instruction?: string } }>('/api/comms/assist', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required for communications intelligence.' });
    const operation = request.body?.operation;
    const conversationId = request.body?.conversationId?.trim();
    const language = request.body?.language?.trim();
    const instruction = request.body?.instruction?.trim();
    if (!operation || !['summarize', 'draft', 'translate', 'extract_tasks'].includes(operation)) {
      return reply.code(400).send({ error: 'Unsupported communications intelligence operation.' });
    }
    if (!conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
      return reply.code(400).send({ error: 'A valid conversation ID is required.' });
    }
    if (instruction && instruction.length > 1000) {
      return reply.code(400).send({ error: 'The additional instruction is too long.' });
    }

    const conversation = await fastify.prisma.communicationConversation.findFirst({
      where: { id: conversationId, ownerUserId: request.authUser.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
          select: { direction: true, body: true, status: true, createdAt: true },
        },
      },
    });
    if (!conversation) return reply.code(404).send({ error: 'Conversation not found for this owner.' });

    const transcript = conversation.messages.map((item) =>
      `[${item.createdAt.toISOString()}] ${item.direction} (${item.status}): ${item.body}`,
    ).join('\n');
    const prompts: Record<string, string> = {
      summarize: 'Summarize this conversation into concise, factual bullets. Separate confirmed facts, open questions and next steps. Do not invent details.',
      draft: 'Prepare a proposed reply to the latest inbound message. Preserve the conversation context and owner intent. This is a draft only and must never imply approval or sending.',
      translate: `Translate the conversation context into ${language || 'the requested target language'}. Preserve meaning and names. Return only the translated text.`,
      extract_tasks: 'Extract actionable tasks from the conversation. For each task give owner, action, due date if explicitly stated, and evidence from the transcript. If a field is unknown, say unknown. Do not create or execute tasks.',
    };
    const prompt = [
      prompts[operation],
      instruction ? `Additional owner instruction: ${instruction}` : '',
      '',
      'Conversation transcript:',
      transcript || '(no messages)',
    ].filter(Boolean).join('\n');

    try {
      const result = await askRyanAI(prompt, `comms-assist:${conversationId}:${operation}`);
      return {
        operation,
        output: result,
        sourceMessageCount: conversation.messages.length,
      };
    } catch (error) {
      request.log.warn({ err: error, operation }, 'Comms intelligence request failed');
      return reply.code(502).send({ error: 'Communications intelligence is temporarily unavailable.' });
    }
  });

  fastify.post<{ Body: CommsBody }>('/api/comms/approve', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ success: false, error: 'Owner access is required to approve outbound communications.' });
    const { channel, recipient, message, subject, contentSid, contentVariables, idempotencyKey, attachmentIds = [], approvalId } = request.body ?? {};
    if (!channel || !['whatsapp', 'sms', 'voice', 'email'].includes(channel)) return reply.code(400).send({ success: false, error: 'Unsupported communication channel.' });
    if (!Array.isArray(attachmentIds) || attachmentIds.length > 8 || new Set(attachmentIds).size !== attachmentIds.length) return reply.code(400).send({ success: false, error: 'At most 8 unique attachment IDs are supported.' });
    if (attachmentIds.length && !areCommunicationAttachmentsEnabled()) return reply.code(503).send({ success: false, error: 'Communication attachments are disabled.' });
    if (attachmentIds.length && (channel === 'voice' || (channel === 'whatsapp' && Boolean(contentSid || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim())))) return reply.code(400).send({ success: false, error: 'Voice and approved WhatsApp template sends cannot include attachments.' });
    const targetValue = recipient || (channel === 'email' ? process.env.RYANAI_OWNER_EMAIL : process.env.RYANAI_OWNER_PHONE);
    const target = typeof targetValue === 'string' ? targetValue.trim() : '';
    const messageBody = typeof message === 'string' ? message.trim() : '';
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    const isOwnerRecipient = channel === 'email'
      ? target.toLowerCase() === process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase()
      : Boolean(target && process.env.RYANAI_OWNER_PHONE && normalizePhone(target) === normalizePhone(process.env.RYANAI_OWNER_PHONE));
    const deliveryBody = isOwnerRecipient ? addressOwnerMessage(messageBody) : messageBody;
    const emailSubject = typeof subject === 'string' && subject.trim() ? subject.trim() : 'RyanAI notification';
    const approvedTemplateSid = typeof contentSid === 'string' ? contentSid.trim() || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim() : process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim();
    if (!key || key.length < 16 || key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key)) return reply.code(400).send({ success: false, error: 'A valid 16–128 character idempotency key is required.' });
    if (!target || ((!messageBody) && !(channel === 'whatsapp' && approvedTemplateSid)) || messageBody.length > MAX_MESSAGE_LENGTH) return reply.code(400).send({ success: false, error: 'channel, recipient and a message of at most 4,000 characters are required.' });
    if (channel === 'email') {
      if (!messageBody) return reply.code(400).send({ success: false, error: 'An email message body is required.' });
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(target)) return reply.code(400).send({ success: false, error: 'Recipient must be a valid email address.' });
      if (typeof subject === 'string' && subject.trim().length > 180) return reply.code(400).send({ success: false, error: 'Email subject must be no longer than 180 characters.' });
    } else if (!E164.test(target)) {
      return reply.code(400).send({ success: false, error: 'Recipient must be a valid E.164 phone number.' });
    }
    if (attachmentIds.length) {
      try {
        const states = await getCommsAttachmentStatuses(fastify.prisma, request.authUser.id, attachmentIds);
        if (states.length !== attachmentIds.length || states.some(item => item.status !== 'clean')) return reply.code(409).send({ success: false, error: 'Attachments are not ready. All malware scans must be clean before approval.' });
      } catch (error) {
        request.log.warn({ err: error }, 'Comms approval attachment validation rejected');
        return reply.code(409).send({ success: false, error: 'Attachments could not be verified for approval.' });
      }
    }
    const requestHash = createCommsDispatchApprovalDigest({
      ownerUserId: request.authUser.id,
      channel,
      recipient: channel === 'email' ? target.toLowerCase() : target,
      deliveryBody: deliveryBody || '[WhatsApp approved template]',
      emailSubject,
      approvedTemplateSid: approvedTemplateSid || null,
      contentVariables: typeof contentVariables === 'string' ? contentVariables : null,
      idempotencyKey: key,
      attachmentIds,
    });
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
    try {
      const approval = await fastify.prisma.commsDispatchApproval.create({
        data: { ownerUserId: request.authUser.id, requestHash, expiresAt },
        select: { id: true, expiresAt: true },
      });
      return reply.code(201).send({ success: true, approvalId: approval.id, expiresAt: approval.expiresAt.toISOString() });
    } catch (error) {
      request.log.error({ err: error }, 'Unable to persist owner Comms dispatch approval');
      return reply.code(503).send({ success: false, error: 'The owner approval could not be recorded. No provider request was sent.' });
    }
  });

  fastify.post<{ Body: CommsBody }>('/api/comms/send', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ success: false, error: 'Owner access is required for outbound communications.' });
    const { channel, recipient, message, subject, contentSid, contentVariables, idempotencyKey, attachmentIds = [] } = request.body ?? {};
    if (attachmentIds.length && !areCommunicationAttachmentsEnabled()) return reply.code(503).send({ success: false, error: 'Communication attachments are disabled.' });
    if (!channel || !['whatsapp', 'sms', 'voice', 'email'].includes(channel)) return reply.code(400).send({ success: false, error: 'Unsupported communication channel.' });
    if (!Array.isArray(attachmentIds) || attachmentIds.length > 8 || new Set(attachmentIds).size !== attachmentIds.length) return reply.code(400).send({ success: false, error: 'At most 8 unique attachment IDs are supported.' });
    if (attachmentIds.length && (channel === 'voice' || (channel === 'whatsapp' && Boolean(contentSid || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim())))) return reply.code(400).send({ success: false, error: 'Voice and approved WhatsApp template sends cannot include attachments.' });
    const targetValue = recipient || (channel === 'email' ? process.env.RYANAI_OWNER_EMAIL : process.env.RYANAI_OWNER_PHONE);
    const target = typeof targetValue === 'string' ? targetValue.trim() : '';
    const messageBody = typeof message === 'string' ? message.trim() : '';
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    const isOwnerRecipient = channel === 'email'
      ? target.toLowerCase() === process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase()
      : Boolean(target && process.env.RYANAI_OWNER_PHONE && normalizePhone(target) === normalizePhone(process.env.RYANAI_OWNER_PHONE));
    const deliveryBody = isOwnerRecipient ? addressOwnerMessage(messageBody) : messageBody;
    const emailSubject = typeof subject === 'string' && subject.trim() ? subject.trim() : 'RyanAI notification';
    const approvedTemplateSid = typeof contentSid === 'string' ? contentSid.trim() || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim() : process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim();
    if (!key || key.length < 16 || key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key)) return reply.code(400).send({ success: false, error: 'A valid 16–128 character idempotency key is required.' });
    if (!target || ((!messageBody) && !(channel === 'whatsapp' && approvedTemplateSid)) || messageBody.length > MAX_MESSAGE_LENGTH) return reply.code(400).send({ success: false, error: 'channel, recipient and a message of at most 4,000 characters are required.' });
    if (channel === 'email') {
      if (!messageBody) return reply.code(400).send({ success: false, error: 'An email message body is required.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) return reply.code(400).send({ success: false, error: 'Recipient must be a valid email address.' });
      if (typeof subject === 'string' && subject.trim().length > 180) return reply.code(400).send({ success: false, error: 'Email subject must be no longer than 180 characters.' });
    } else if (!E164.test(target)) {
      return reply.code(400).send({ success: false, error: 'Recipient must be a valid E.164 phone number.' });
    }
    const smtp = channel === 'email' ? smtpTransport() : null;
    if (channel === 'email' && !smtp) return reply.code(503).send({ success: false, error: 'SMTP is not configured.' });
    const client = channel !== 'email' ? twilioClient() : null;
    if (channel !== 'email' && !client) return reply.code(503).send({ success: false, error: 'Twilio is not configured.' });
    let from = '';
    if (channel === 'whatsapp') from = process.env.TWILIO_WHATSAPP_NUMBER?.trim() || '';
    else if (channel === 'sms' || channel === 'voice') from = process.env.TWILIO_PHONE_NUMBER?.trim() || '';
    if (channel !== 'email' && !from) return reply.code(503).send({ success: false, error: `Twilio ${channel} sender is not configured.` });
    if (channel === 'voice' && !process.env.TWILIO_VOICE_ACTION_URL?.trim()) return reply.code(503).send({ success: false, error: 'Twilio voice action URL is not configured.' });
    if (typeof approvalId !== 'string' || !approvalId.trim()) return reply.code(403).send({ success: false, error: 'A current owner approval is required before outbound dispatch.' });
    const requestHash = createCommsDispatchApprovalDigest({
      ownerUserId: request.authUser.id,
      channel,
      recipient: channel === 'email' ? target.toLowerCase() : target,
      deliveryBody: deliveryBody || '[WhatsApp approved template]',
      emailSubject,
      approvedTemplateSid: approvedTemplateSid || null,
      contentVariables: typeof contentVariables === 'string' ? contentVariables : null,
      idempotencyKey: key,
      attachmentIds,
    });
    const outboundBody = deliveryBody || '[WhatsApp approved template]';
    let attachmentUrls: string[] = [];
    let emailAttachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    if (attachmentIds.length) {
      try {
        const states = await getCommsAttachmentStatuses(fastify.prisma, request.authUser.id, attachmentIds);
        if (states.length !== attachmentIds.length || states.some(item => item.status !== 'clean')) return reply.code(409).send({ success: false, error: 'Attachments are not ready. All malware scans must be clean before sending.' });
        if (channel === 'email') emailAttachments = await downloadCleanCommsAttachments(fastify.prisma, request.authUser.id, attachmentIds);
        else attachmentUrls = [...(await cleanCommsAttachmentUrls(fastify.prisma, request.authUser.id, attachmentIds, 900)).values()];
      } catch (error) {
        request.log.warn({ err: error }, 'Attachment validation blocked outbound send');
        return reply.code(409).send({ success: false, error: error instanceof Error ? error.message : 'Attachments are not ready.' });
      }
    }
    const consumedAt = new Date();
    let consumedApproval;
    try {
      consumedApproval = await fastify.prisma.commsDispatchApproval.updateMany({
        where: {
          id: approvalId,
          ownerUserId: request.authUser.id,
          requestHash,
          status: 'approved',
          expiresAt: { gt: consumedAt },
          consumedAt: null,
        },
        data: { status: 'consumed', consumedAt },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Unable to consume owner Comms dispatch approval');
      return reply.code(503).send({ success: false, error: 'The owner approval could not be verified. No provider request was sent.' });
    }
    if (consumedApproval.count !== 1) return reply.code(409).send({ success: false, error: 'The owner approval is expired, already used, belongs to another owner, or does not match this exact outbound action.' });
    let reservation;
    try {
      reservation = await beginOutboundCommunication(fastify.prisma, {
        channel,
        externalAddress: channel === 'email' ? target.toLowerCase() : target,
        body: outboundBody,
        idempotencyKey: key,
        ownerUserId: request.authUser.id,
        ...(channel === 'email' ? { metadata: { subject: emailSubject } } : {}),
      });
    } catch (error) {
      if (error instanceof OutboundIdempotencyConflictError) return reply.code(409).send({ success: false, error: error.message });
      request.log.error({ err: error, channel }, 'Unable to reserve outbound communication');
      return reply.code(503).send({ success: false, error: 'The communication could not be safely reserved. No provider request was sent.' });
    }
    if (reservation.replayed) return reply.code(202).send({
      success: true, channel, providerId: reservation.providerMessageId, status: reservation.status, replayed: true,
    });
    try {
      if (channel === 'email') {
        const sent = await smtp!.transporter.sendMail({ from: smtp!.from, to: target, subject: emailSubject, text: deliveryBody, ...(emailAttachments.length ? { attachments: emailAttachments } : {}) });
        await completeOutboundCommunication(fastify.prisma, { id: reservation.id, providerMessageId: sent.messageId, status: 'accepted' });
        return reply.code(202).send({ success: true, channel, providerId: sent.messageId, status: 'accepted', replayed: false });
      }
      if (channel === 'whatsapp' || channel === 'sms') {
        const sent = await client!.messages.create({
          from: channel === 'whatsapp' && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from,
          to: channel === 'whatsapp' ? `whatsapp:${target}` : target,
          ...(channel === 'whatsapp' && approvedTemplateSid
            ? { contentSid: approvedTemplateSid, ...(typeof contentVariables === 'string' ? { contentVariables } : {}) }
            : { body: deliveryBody }),
          ...(attachmentUrls.length ? { mediaUrl: attachmentUrls } : {}),
          ...(process.env.TWILIO_STATUS_CALLBACK_URL ? { statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL } : {}),
        });
        await completeOutboundCommunication(fastify.prisma, { id: reservation.id, providerMessageId: sent.sid, status: sent.status });
        return reply.code(202).send({ success: true, channel, providerId: sent.sid, status: sent.status, replayed: false });
      }
      const call = await client!.calls.create({
        to: target, from, twiml: twimlSay(deliveryBody),
        ...(process.env.TWILIO_STATUS_CALLBACK_URL ? { statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL } : {}),
      });
      await completeOutboundCommunication(fastify.prisma, { id: reservation.id, providerMessageId: call.sid, status: call.status });
      return reply.code(202).send({ success: true, channel, providerId: call.sid, status: call.status, replayed: false });
    } catch (error) {
      try { await markOutboundCommunicationUnknown(fastify.prisma, reservation.id); }
      catch (persistenceError) { request.log.error({ err: persistenceError, channel }, 'Unable to mark outbound communication outcome as unknown'); }
      request.log.error({ err: error, channel }, 'Communication provider request or result persistence failed');
      return reply.code(502).send({ success: false, error: 'Communication outcome is unknown. The idempotency key remains reserved to prevent duplicate dispatch.' });
    }
  });

  fastify.get('/api/comms/conversations', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required.' });
    const rawLimit = Number((request.query as { limit?: string })?.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 50;
    const ownerUserId = request.authUser.id;
    await fastify.prisma.communicationConversation.updateMany({ where: { ownerUserId: null }, data: { ownerUserId } });
    const conversations = await fastify.prisma.communicationConversation.findMany({
      where: { ownerUserId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true, channel: true, externalAddress: true, updatedAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true, direction: true, body: true, status: true,
            providerMessageId: true, metadata: true, createdAt: true,
            attachments: { select: { id: true, fileName: true, mimeType: true, size: true, objectName: true } },
          },
        },
      },
    });
    const allAttachments = conversations.flatMap(item => item.messages.flatMap(message => message.attachments));
    let states: Record<string, string> = {};
    if (allAttachments.length) {
      try { states = await getCommsAttachmentScanStates(createCommsStorageAdmin(), allAttachments.map(item => ({ id: item.id, objectName: item.objectName }))); }
      catch (error) { request.log.warn({ err: error }, 'Unable to read attachment scan states'); }
    }
    return {
      status: 'history',
      conversations: conversations.map((conversation) => ({
        ...conversation,
        messages: [...conversation.messages].reverse().map(message => ({
          ...message,
          attachments: message.attachments.map(attachment => ({
            id: attachment.id, name: attachment.fileName, mimeType: attachment.mimeType,
            size: Number(attachment.size), status: states[attachment.id] || 'unavailable',
          })),
        })),
      })),
      pagination: { limit, returned: conversations.length },
    };
  });

  fastify.get('/api/comms/status', async () => ({
    status: 'configuration_snapshot',
    channels: {
      whatsapp: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER && process.env.TWILIO_WHATSAPP_WEBHOOK_URL && process.env.RYANAI_OWNER_PHONE),
      sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER && process.env.TWILIO_SMS_WEBHOOK_URL && process.env.RYANAI_OWNER_PHONE),
      voice: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER && process.env.TWILIO_VOICE_WEBHOOK_URL && process.env.TWILIO_VOICE_ACTION_URL),
      email: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM && process.env.RYANAI_OWNER_EMAIL),
      inboundEmail: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET),
      attachments: areCommunicationAttachmentsEnabled() && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    ai: {
      openai: {
        status: process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_BASE_URL?.trim()
          ? 'configured_unverified'
          : 'missing_credentials',
      },
    },
    note: 'Configuration presence only; this endpoint does not claim live provider connectivity or successful model authentication.',
  }));

  fastify.post('/api/webhooks/twilio/voice', { preHandler: webhookAuth('TWILIO_VOICE_WEBHOOK_URL') }, async (request, reply) => {
    const body = request.body as { From?: string; CallSid?: string };
    const sender = body.From ? normalizePhone(body.From) : '';
    const owner = process.env.RYANAI_OWNER_PHONE?.trim();
    if (!owner) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    if (sender !== normalizePhone(owner)) return reply.code(403).send({ error: 'This voice assistant is privately configured.' });
    if (body.CallSid) await recordCommunication(fastify.prisma, {
      channel: 'voice', externalAddress: sender, direction: 'inbound',
      body: 'Incoming voice call started', providerMessageId: body.CallSid, status: 'in_progress', ownerUserId: process.env.RYANAI_OWNER_AUTH_USER_ID,
    });
    reply.type('text/xml');
    return twimlSay(getOwnerGreeting());
  });

  fastify.post('/api/webhooks/twilio/voice/respond', { preHandler: webhookAuth('TWILIO_VOICE_ACTION_URL') }, async (request, reply) => {
    const body = request.body as { SpeechResult?: string; CallSid?: string; From?: string; To?: string };
    const owner = process.env.RYANAI_OWNER_PHONE?.trim();
    if (!owner) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    const ownerPhone = normalizePhone(owner);
    const fromPhone = body.From ? normalizePhone(body.From) : '';
    const toPhone = body.To ? normalizePhone(body.To) : '';
    const sender = fromPhone === ownerPhone ? fromPhone : toPhone === ownerPhone ? toPhone : '';
    const speech = body.SpeechResult?.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!sender) return reply.code(403).send({ error: 'This voice assistant is privately configured.' });
    reply.type('text/xml');
    if (!speech) return twimlSay('I did not catch that. Please try again.', true);
    const thread = `voice_${(body.CallSid || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')}`;
    try {
      await recordCommunication(fastify.prisma, {
        channel: 'voice', externalAddress: sender, direction: 'inbound', body: speech,
        status: 'received', metadata: { callSid: body.CallSid || '' }, ownerUserId: process.env.RYANAI_OWNER_AUTH_USER_ID,
      });
      const answer = addressOwnerResponse(await askRyanAI(speech, thread));
      await recordCommunication(fastify.prisma, {
        channel: 'voice', externalAddress: sender, direction: 'outbound',
        body: answer, status: 'response_generated', metadata: { callSid: body.CallSid || '' }, ownerUserId: process.env.RYANAI_OWNER_AUTH_USER_ID,
      });
      return twimlSay(answer.slice(0, MAX_MESSAGE_LENGTH), true);
    } catch (error) {
      request.log.error({ err: error }, 'RyanAI voice conversation failed');
      return twimlSay('I am temporarily unable to process that request. Please try again later.', false);
    }
  });

  fastify.post('/api/webhooks/twilio/sms', { preHandler: webhookAuth('TWILIO_SMS_WEBHOOK_URL') }, async (request, reply) => {
    const body = request.body as Record<string, string | undefined>;
    const sender = body.From ? normalizePhone(body.From) : '';
    const text = body.Body?.trim().slice(0, MAX_MESSAGE_LENGTH) || '';
    const owner = process.env.RYANAI_OWNER_PHONE?.trim();
    let media: ReturnType<typeof parseTwilioMedia>;
    try { media = parseTwilioMedia(body); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid Twilio media payload.' }); }
    if (!sender || !body.MessageSid || (!text && media.length === 0)) return reply.code(400).send({ error: 'Invalid SMS webhook payload.' });
    if (!owner) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    if (sender !== normalizePhone(owner)) return reply.code(403).send({ error: 'This assistant is privately configured.' });
    const ownerUserId = getOwnerInboundUserId();
    if (media.length && !ownerUserId) return reply.code(503).send({ error: 'Inbound media storage requires the verified owner Supabase user ID.' });
    let mediaStorageFailed = false;
    try {
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'sms',
        externalAddress: sender,
        body: text || `[${media.length} media attachment(s)]`,
        providerMessageId: body.MessageSid,
        status: 'processing',
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(media.length ? { metadata: { mediaCount: media.length } } : {}),
      });
      if (!claim.claimed) {
        const previousReply = claim.existing?.metadata && typeof claim.existing.metadata === 'object'
          && !Array.isArray(claim.existing.metadata)
          ? (claim.existing.metadata as { reply?: unknown }).reply : undefined;
        reply.type('text/xml');
        if (typeof previousReply === 'string' && previousReply.length) {
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(previousReply.slice(0, 1600))}</Message></Response>`;
        }
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      if (media.length) {
        try { await storeTwilioMediaForCommunication(fastify.prisma, body.MessageSid, media); }
        catch (error) { mediaStorageFailed = true; throw error; }
      }
      const prompt = text
        ? text + (media.length ? `\\n\\nThe sender attached ${media.length} file(s). They have been stored securely but have not been analyzed. Do not claim to have inspected their contents.` : '')
        : `The sender attached ${media.length} file(s). They have been stored securely, but their contents have not been analyzed. Tell Sir they were received without claiming to inspect them.`;
      const answer = addressOwnerResponse(await askRyanAI(prompt, `sms_${sender.replace(/\\D/g, '')}`));
      await fastify.prisma.communicationMessage.update({
        where: { providerMessageId: body.MessageSid },
        data: { status: 'replied', metadata: { reply: answer, mediaCount: media.length } },
      });
      await recordCommunication(fastify.prisma, {
        channel: 'sms', externalAddress: sender, direction: 'outbound', body: answer,
        status: 'response_generated', metadata: { inReplyTo: body.MessageSid },
        ...(ownerUserId ? { ownerUserId } : {}),
      });
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(answer.slice(0, 1600))}</Message></Response>`;
    } catch (error) {
      if (mediaStorageFailed) {
        await fastify.prisma.communicationMessage.updateMany({
          where: { providerMessageId: body.MessageSid, status: 'processing' },
          data: { status: 'attachment_failed' },
        }).catch((persistenceError) => request.log.error({ err: persistenceError }, 'Unable to persist inbound media retry state'));
        request.log.error({ err: error }, 'Inbound SMS media storage failed');
        return reply.code(503).send({ error: 'Inbound media is temporarily unavailable; the provider may retry this webhook.' });
      }
      request.log.error({ err: error }, 'RyanAI SMS conversation failed');
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>RyanAI is temporarily unavailable. Please try again later.</Message></Response>`;
    }
  });

  fastify.post('/api/webhooks/twilio/status', { preHandler: webhookAuth('TWILIO_STATUS_WEBHOOK_URL') }, async (request) => {
    const body = request.body as Record<string, string>;
    const providerId = body.MessageSid || body.CallSid;
    const status = body.MessageStatus || body.CallStatus;
    if (providerId && status) {
      await updateCommunicationStatus(fastify.prisma, providerId, status);
    }
    return { received: true };
  });

  fastify.post('/api/webhooks/resend/inbound', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
    const ownerEmail = process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase();
    if (!apiKey || !secret || !ownerEmail) {
      return reply.code(503).send({ error: 'Inbound email is not configured.' });
    }
    const resend = new Resend(apiKey);
    let claimedEmailId: string | undefined;
    let inboundAttachmentStorageFailed = false;
    try {
      const event = resend.webhooks.verify({
        payload: typeof request.rawBody === 'string' ? request.rawBody : request.rawBody?.toString('utf8') ?? '',
        headers: {
          id: String(request.headers['svix-id'] ?? ''),
          timestamp: String(request.headers['svix-timestamp'] ?? ''),
          signature: String(request.headers['svix-signature'] ?? ''),
        },
        webhookSecret: secret,
      }) as { type?: string; data?: { email_id?: string; from?: string } };
      if (event.type !== 'email.received' || !event.data?.email_id) {
        return { received: true, ignored: true };
      }
      const received = await resend.emails.receiving.get(event.data.email_id);
      if (received.error || !received.data) {
        request.log.error({ error: received.error }, 'Could not retrieve inbound email content');
        return reply.code(502).send({ error: 'Could not retrieve inbound email content.' });
      }
      const email = received.data as { id: string; from: string; subject?: string; text?: string | null; html?: string | null };
      const sender = emailAddress(email.from);
      if (sender !== ownerEmail) {
        request.log.warn({ sender }, 'Rejected inbound email from non-owner sender');
        return reply.code(403).send({ error: 'This email assistant is privately configured.' });
      }
      const bodyText = (email.text || email.html?.replace(/<[^>]*>/g, ' ') || '').trim().slice(0, MAX_MESSAGE_LENGTH);
      const listed = await resend.emails.receiving.attachments.list({ emailId: email.id });
      if (listed.error || !listed.data) {
        request.log.error({ error: listed.error }, 'Could not list inbound email attachments');
        return reply.code(502).send({ error: 'Could not list inbound email attachments.' });
      }
      const inboundAttachments = listed.data.data ?? [];
      if (inboundAttachments.length > 8 || listed.data.has_more) return reply.code(413).send({ error: 'Inbound email exceeds the eight-attachment limit.' });
      if (!bodyText && inboundAttachments.length === 0) return reply.code(400).send({ error: 'Inbound email has no readable text body or supported attachments.' });
      const ownerUserId = getOwnerInboundUserId();
      if (inboundAttachments.length && !ownerUserId) return reply.code(503).send({ error: 'Inbound media storage requires the verified owner Supabase user ID.' });
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'email',
        externalAddress: sender,
        body: bodyText || `[${inboundAttachments.length} email attachment(s)]`,
        providerMessageId: email.id,
        status: 'processing',
        metadata: { subject: email.subject || '', attachmentCount: inboundAttachments.length },
        ...(ownerUserId ? { ownerUserId } : {}),
      });
      if (!claim.claimed) return { received: true, duplicate: true };
      claimedEmailId = email.id;
      if (inboundAttachments.length) {
        try {
          const storedMessage = await fastify.prisma.communicationMessage.findUnique({
          where: { providerMessageId: email.id },
          select: { id: true, conversationId: true },
        });
        if (!storedMessage || !ownerUserId) throw new Error('Inbound email attachments lack an owner-bound communication message.');
        for (const attachment of inboundAttachments) {
          if (!attachment.download_url || !attachment.content_type) throw new Error('Resend attachment metadata is incomplete.');
          const bytes = await downloadResendMedia(attachment.download_url);
          await storeInboundCommsAttachment(fastify.prisma, {
            ownerUserId,
            messageId: storedMessage.id,
            conversationId: storedMessage.conversationId,
            fileName: attachment.filename || `resend-attachment-${attachment.id}`,
            mimeType: attachment.content_type,
            bytes,
            source: 'inbound_resend',
            providerMediaId: attachment.id,
          });
          }
        } catch (attachmentError) {
          inboundAttachmentStorageFailed = true;
          throw attachmentError;
        }
      }
      const prompt = bodyText
        ? bodyText + (inboundAttachments.length ? `\\n\\nThe email included ${inboundAttachments.length} securely stored file(s). Their contents have not been analyzed; do not claim to have inspected them.` : '')
        : `The email included ${inboundAttachments.length} securely stored file(s). Their contents have not been analyzed. Tell Sir they were received without claiming to inspect them.`;
      const answer = addressOwnerResponse(await askRyanAI(prompt, `email_${sender.replace(/[^a-z0-9]/gi, '_')}`));
      const smtp = smtpTransport();
      if (!smtp) {
        await fastify.prisma.communicationMessage.update({
          where: { providerMessageId: email.id }, data: { status: 'reply_not_sent', metadata: { subject: email.subject || '', reply: answer } },
        });
        return reply.code(503).send({ error: 'SMTP reply channel is not configured; inbound message was saved.' });
      }
      const sent = await smtp.transporter.sendMail({
        from: smtp.from, to: sender,
        subject: `Re: ${email.subject || 'Message to RyanAI'}`, text: answer,
      });
      await fastify.prisma.communicationMessage.update({
        where: { providerMessageId: email.id }, data: { status: 'replied', metadata: { subject: email.subject || '', reply: answer } },
      });
      await recordCommunication(fastify.prisma, {
        channel: 'email', externalAddress: sender, direction: 'outbound',
        body: answer, providerMessageId: sent.messageId, status: 'accepted', ownerUserId: process.env.RYANAI_OWNER_AUTH_USER_ID,
      });
      return { received: true, replied: true };
    } catch (error) {
      if (inboundAttachmentStorageFailed && claimedEmailId) {
        await fastify.prisma.communicationMessage.updateMany({
          where: { providerMessageId: claimedEmailId, status: 'processing' },
          data: { status: 'attachment_failed' },
        }).catch((persistenceError) => request.log.error({ err: persistenceError }, 'Unable to persist inbound email attachment retry state'));
      }
      request.log.error({ err: error }, 'Resend inbound email webhook failed');
      return reply.code(502).send({ error: 'Inbound email processing failed.' });
    }
  });
};
