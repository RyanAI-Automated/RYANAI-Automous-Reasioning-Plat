import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import formbody from '@fastify/formbody';
import rawBody from 'fastify-raw-body';
import { Resend } from 'resend';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';
import { beginOutboundCommunication, claimInboundCommunication, completeOutboundCommunication, markOutboundCommunicationUnknown, OutboundIdempotencyConflictError, recordCommunication, updateCommunicationStatus } from './history.js';
import { addressOwnerMessage, getOwnerGreeting } from './personalization.js';
import { addressOwnerResponse, ownerCommunicationInstruction, RYANAI_LOCALE } from '../../shared/ryanIdentity.js';

type Channel = 'whatsapp' | 'sms' | 'voice' | 'email';
type CommsBody = { channel?: Channel; recipient?: string; message?: string; subject?: string; contentSid?: string; contentVariables?: string };
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
  await fastify.register(formbody);
  await fastify.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true });

  fastify.post<{ Body: CommsBody }>('/api/comms/send', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ success: false, error: 'Owner access is required for outbound communications.' });
    const { channel, recipient, message, subject, contentSid, contentVariables, idempotencyKey } = request.body ?? {};
    if (!channel || !['whatsapp', 'sms', 'voice', 'email'].includes(channel)) return reply.code(400).send({ success: false, error: 'Unsupported communication channel.' });
    const targetValue = recipient || (channel === 'email' ? process.env.RYANAI_OWNER_EMAIL : process.env.RYANAI_OWNER_PHONE);
    const target = typeof targetValue === 'string' ? targetValue.trim() : '';
    const messageBody = typeof message === 'string' ? message.trim() : '';
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    const isOwnerRecipient = channel === 'email'
      ? target.toLowerCase() === process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase()
      : Boolean(target && process.env.RYANAI_OWNER_PHONE && normalizePhone(target) === normalizePhone(process.env.RYANAI_OWNER_PHONE));
    const deliveryBody = isOwnerRecipient ? addressOwnerMessage(messageBody) : messageBody;
    const approvedTemplateSid = typeof contentSid === 'string' ? contentSid.trim() || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim() : process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim();
    if (!key || key.length < 16 || key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key)) return reply.code(400).send({ success: false, error: 'A valid 16–128 character idempotency key is required.' });
    if (!target || ((!messageBody) && !(channel === 'whatsapp' && approvedTemplateSid)) || messageBody.length > MAX_MESSAGE_LENGTH) return reply.code(400).send({ success: false, error: 'channel, recipient and a message of at most 4,000 characters are required.' });
    if (channel === 'email') {
      if (!messageBody) return reply.code(400).send({ success: false, error: 'An email message body is required.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) return reply.code(400).send({ success: false, error: 'Recipient must be a valid email address.' });
      if (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 180) return reply.code(400).send({ success: false, error: 'Email subject must contain 1–180 characters.' });
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
    const outboundBody = deliveryBody || '[WhatsApp approved template]';
    let reservation;
    try {
      reservation = await beginOutboundCommunication(fastify.prisma, {
        channel,
        externalAddress: channel === 'email' ? target.toLowerCase() : target,
        body: outboundBody,
        idempotencyKey: key,
        ...(channel === 'email' ? { metadata: { subject: (subject as string).trim() } } : {}),
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
        const sent = await smtp!.transporter.sendMail({ from: smtp!.from, to: target, subject: (subject as string).trim(), text: deliveryBody });
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
    const conversations = await fastify.prisma.communicationConversation.findMany({
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
          },
        },
      },
    });
    return {
      status: 'history',
      conversations: conversations.map((conversation) => ({
        ...conversation,
        messages: [...conversation.messages].reverse(),
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
      body: 'Incoming voice call started', providerMessageId: body.CallSid, status: 'in_progress',
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
        status: 'received', metadata: { callSid: body.CallSid || '' },
      });
      const answer = addressOwnerResponse(await askRyanAI(speech, thread));
      await recordCommunication(fastify.prisma, {
        channel: 'voice', externalAddress: sender, direction: 'outbound',
        body: answer, status: 'response_generated', metadata: { callSid: body.CallSid || '' },
      });
      return twimlSay(answer.slice(0, MAX_MESSAGE_LENGTH), true);
    } catch (error) {
      request.log.error({ err: error }, 'RyanAI voice conversation failed');
      return twimlSay('I am temporarily unable to process that request. Please try again later.', false);
    }
  });

  fastify.post('/api/webhooks/twilio/sms', { preHandler: webhookAuth('TWILIO_SMS_WEBHOOK_URL') }, async (request, reply) => {
    const body = request.body as { From?: string; Body?: string; MessageSid?: string };
    const sender = body.From ? normalizePhone(body.From) : '';
    const text = body.Body?.trim().slice(0, MAX_MESSAGE_LENGTH);
    const owner = process.env.RYANAI_OWNER_PHONE?.trim();
    if (!sender || !text || !body.MessageSid) return reply.code(400).send({ error: 'Invalid SMS webhook payload.' });
    if (!owner) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    if (sender !== normalizePhone(owner)) return reply.code(403).send({ error: 'This assistant is privately configured.' });
    reply.type('text/xml');
    try {
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'sms', externalAddress: sender,
        body: text, providerMessageId: body.MessageSid, status: 'processing',
      });
      if (!claim.claimed) {
        const previousReply = claim.existing?.metadata && typeof claim.existing.metadata === 'object'
          && !Array.isArray(claim.existing.metadata)
          ? (claim.existing.metadata as { reply?: unknown }).reply
          : undefined;
        if (typeof previousReply === 'string' && previousReply.length) {
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(previousReply.slice(0, 1600))}</Message></Response>`;
        }
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      const answer = addressOwnerResponse(await askRyanAI(text, `sms_${sender.replace(/\D/g, '')}`));
      await fastify.prisma.communicationMessage.update({
        where: { providerMessageId: body.MessageSid }, data: { status: 'replied', metadata: { reply: answer } },
      });
      await recordCommunication(fastify.prisma, {
        channel: 'sms', externalAddress: sender, direction: 'outbound', body: answer,
        status: 'response_generated', metadata: { inReplyTo: body.MessageSid },
      });
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(answer.slice(0, 1600))}</Message></Response>`;
    } catch (error) {
      request.log.error({ err: error }, 'RyanAI SMS conversation failed');
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
      if (!bodyText) return reply.code(400).send({ error: 'Inbound email has no readable text body.' });
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'email', externalAddress: sender,
        body: bodyText, providerMessageId: email.id, status: 'processing',
        metadata: { subject: email.subject || '' },
      });
      if (!claim.claimed) return { received: true, duplicate: true };
      const answer = addressOwnerResponse(await askRyanAI(bodyText, `email_${sender.replace(/[^a-z0-9]/gi, '_')}`));
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
        body: answer, providerMessageId: sent.messageId, status: 'accepted',
      });
      return { received: true, replied: true };
    } catch (error) {
      request.log.error({ err: error }, 'Resend inbound email webhook failed');
      return reply.code(400).send({ error: 'Invalid inbound email webhook or processing failure.' });
    }
  });
};
