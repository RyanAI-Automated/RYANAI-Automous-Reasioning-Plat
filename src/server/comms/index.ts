import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import formbody from '@fastify/formbody';
import rawBody from 'fastify-raw-body';
import { Resend } from 'resend';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';
import { recordCommunication, updateCommunicationStatus } from './history.js';
import { addressOwnerResponse, getTimeGreeting } from '../../shared/ryanIdentity.js';
import { communicationSystemInstruction, getOwnerTitle, getTwilioVoiceLanguage } from './language.js';

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
function twimlSay(text: string, gather = true): string {
  const action = process.env.TWILIO_VOICE_ACTION_URL?.trim();
  const locale = getTwilioVoiceLanguage();
  const configuredVoice = process.env.RYANAI_TWILIO_VOICE?.trim();
  const voice = configuredVoice || (locale === 'en-ZA' ? 'Polly.Ayanda-Neural' : '');
  const voiceAttribute = voice ? ` voice="${escapeXml(voice)}"` : '';
  const say = (value: string) => `<Say language="${escapeXml(locale)}"${voiceAttribute}>${escapeXml(value)}</Say>`;
  if (!action || !gather) return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(text)}<Hangup/></Response>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(text)}<Gather input="speech" language="${escapeXml(locale)}" action="${escapeXml(action)}" method="POST" speechTimeout="auto" timeout="5">${say('Please speak after the tone.')}</Gather>${say('I did not hear a response. Goodbye.')}<Hangup/></Response>`;
}
async function askRyanAI(text: string, threadId: string): Promise<string> {
  const result = await humanInTheLoopAgent.invoke(
    { messages: [
      { role: 'system', content: communicationSystemInstruction() },
      { role: 'user', content: text },
    ] },
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
    const { channel, recipient, message, subject, contentSid, contentVariables } = request.body ?? {};
    const target = recipient || (channel === 'email' ? process.env.RYANAI_OWNER_EMAIL : process.env.RYANAI_OWNER_PHONE);
    const messageBody = message?.trim() ?? '';
    const approvedTemplateSid = contentSid?.trim() || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim();
    if (!channel || !target || ((!messageBody) && !(channel === 'whatsapp' && approvedTemplateSid)) || messageBody.length > MAX_MESSAGE_LENGTH) {
      return reply.code(400).send({ success: false, error: 'channel, recipient and a message of at most 4,000 characters are required.' });
    }
    if (!['whatsapp', 'sms', 'voice', 'email'].includes(channel)) {
      return reply.code(400).send({ success: false, error: 'Unsupported communication channel.' });
    }
    if (channel === 'email') {
      if (!messageBody) return reply.code(400).send({ success: false, error: 'An email message body is required.' });
      const smtp = smtpTransport();
      if (!smtp) return reply.code(503).send({ success: false, error: 'SMTP is not configured.' });
      try {
        const outgoingText = target.toLowerCase() === process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase() ? addressOwnerResponse(messageBody, getOwnerTitle()) : messageBody;
        const sent = await smtp.transporter.sendMail({
          from: smtp.from, to: target, subject: subject || 'RyanAI notification', text: outgoingText,
        });
        await recordCommunication(fastify.prisma, {
          channel, externalAddress: target.toLowerCase(), direction: 'outbound',
          body: outgoingText, providerMessageId: sent.messageId, status: 'accepted',
        });
        return reply.code(202).send({ success: true, channel, providerId: sent.messageId, status: 'accepted' });
      } catch (error) {
        request.log.error({ err: error }, 'Email provider rejected message');
        return reply.code(502).send({ success: false, error: 'Email provider delivery failed.' });
      }
    }

    const client = twilioClient();
    if (!client) return reply.code(503).send({ success: false, error: 'Twilio is not configured.' });
    if (!E164.test(target)) return reply.code(400).send({ success: false, error: 'Recipient must be a valid E.164 phone number.' });

    try {
      if (channel === 'whatsapp' || channel === 'sms') {
        const from = channel === 'whatsapp'
          ? process.env.TWILIO_WHATSAPP_NUMBER?.trim()
          : process.env.TWILIO_PHONE_NUMBER?.trim();
        if (!from) return reply.code(503).send({ success: false, error: `Twilio ${channel} sender is not configured.` });
        const outgoingText = target === process.env.RYANAI_OWNER_PHONE?.trim() ? addressOwnerResponse(messageBody) : messageBody;
        const sent = await client.messages.create({
          from: channel === 'whatsapp' && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from,
          to: channel === 'whatsapp' ? `whatsapp:${target}` : target,
          ...(channel === 'whatsapp' && approvedTemplateSid
            ? {
                contentSid: approvedTemplateSid,
                ...(contentVariables ? { contentVariables } : {}),
              }
            : { body: outgoingText }),
          ...(process.env.TWILIO_STATUS_CALLBACK_URL ? { statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL } : {}),
        });
        await recordCommunication(fastify.prisma, {
          channel, externalAddress: target, direction: 'outbound', body: outgoingText || '[WhatsApp approved template]',
          providerMessageId: sent.sid, status: sent.status,
        });
        return reply.code(202).send({ success: true, channel, providerId: sent.sid, status: sent.status });
      }
      const from = process.env.TWILIO_PHONE_NUMBER?.trim();
      if (!from || !process.env.TWILIO_VOICE_ACTION_URL?.trim()) {
        return reply.code(503).send({ success: false, error: 'Twilio voice caller ID or voice action URL is not configured.' });
      }
      const outgoingText = target === process.env.RYANAI_OWNER_PHONE?.trim() ? addressOwnerResponse(messageBody) : messageBody;
      const call = await client.calls.create({
        to: target, from, twiml: twimlSay(outgoingText),
        ...(process.env.TWILIO_STATUS_CALLBACK_URL ? { statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL } : {}),
      });
      await recordCommunication(fastify.prisma, {
        channel, externalAddress: target, direction: 'outbound', body: outgoingText,
        providerMessageId: call.sid, status: call.status,
      });
      return reply.code(202).send({ success: true, channel, providerId: call.sid, status: call.status });
    } catch (error) {
      request.log.error({ err: error, channel }, 'Communication provider rejected request');
      return reply.code(502).send({ success: false, error: 'Communication provider request failed.' });
    }
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
    note: 'Configuration presence only; this endpoint does not claim live provider connectivity.',
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
    return twimlSay(`${getTimeGreeting()}, Sir. I'm RyanAI. How can I help you today?`);
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
      const answer = addressOwnerResponse(await askRyanAI(speech, thread), getOwnerTitle());
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
      await recordCommunication(fastify.prisma, {
        channel: 'sms', externalAddress: sender, direction: 'inbound',
        body: text, providerMessageId: body.MessageSid, status: 'processing',
      });
      const answer = addressOwnerResponse(await askRyanAI(text, `sms_${sender.replace(/\D/g, '')}`), getOwnerTitle());
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
      await updateCommunicationStatus(fastify.prisma, providerId, status, {
        errorCode: body.ErrorCode || '',
      });
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
      const existing = await fastify.prisma.communicationMessage.findUnique({
        where: { providerMessageId: email.id },
      });
      if (existing?.status === 'replied') return { received: true, duplicate: true };
      await recordCommunication(fastify.prisma, {
        channel: 'email', externalAddress: sender, direction: 'inbound',
        body: bodyText, providerMessageId: email.id, status: 'processing',
        metadata: { subject: email.subject || '' },
      });
      const answer = addressOwnerResponse(await askRyanAI(bodyText, `email_${sender.replace(/[^a-z0-9]/gi, '_')}`), getOwnerTitle());
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
