import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import formbody from '@fastify/formbody';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';

type Channel = 'whatsapp' | 'sms' | 'voice' | 'email';
type CommsBody = {
  channel?: Channel;
  recipient?: string;
  message?: string;
  subject?: string;
};

const MAX_MESSAGE_LENGTH = 4000;
const E164 = /^\+[1-9]\d{7,14}$/;

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[char] ?? char);
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
    if (!token || !url) {
      return reply.code(503).send({ error: 'Twilio webhook authentication is not configured.' });
    }
    if (typeof signature !== 'string' || !twilio.validateRequest(
      token, signature, url, (request.body || {}) as Record<string, string>,
    )) {
      return reply.code(401).send({ error: 'Invalid Twilio request signature.' });
    }
  };
}

function twimlSay(text: string, gather = true): string {
  const safe = escapeXml(text);
  const action = process.env.TWILIO_VOICE_ACTION_URL?.trim();
  if (!action || !gather) return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${safe}</Say><Hangup/></Response>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${safe}</Say><Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" timeout="5"><Say>Please speak after the tone.</Say></Gather><Say>I did not hear a response. Goodbye.</Say><Hangup/></Response>`;
}

async function askRyanAI(text: string, threadId: string): Promise<string> {
  const result = await humanInTheLoopAgent.invoke(
    { messages: [{ role: 'user', content: text }] },
    { configurable: { thread_id: threadId } },
  );
  const messages = (result as { messages?: Array<{ content?: unknown }> }).messages ?? [];
  const content = messages.at(-1)?.content;
  return typeof content === 'string' ? content : JSON.stringify(content) ?? 'I could not prepare a response.';
}

/**
 * Real provider-backed communications gateway. Outbound routes are administrator
 * protected by the global auth hook; Twilio callbacks are public only because each
 * validates the provider signature against a fixed configured URL.
 */
export const commsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(formbody);

  fastify.post<{ Body: CommsBody }>('/api/comms/send', async (request, reply) => {
    const { channel, recipient, message, subject } = request.body ?? {};
    const targetRecipient = recipient || (channel === 'email' ? process.env.RYANAI_OWNER_EMAIL : process.env.RYANAI_OWNER_PHONE);
    if (!channel || !targetRecipient || !message || message.length > MAX_MESSAGE_LENGTH) {
      return reply.code(400).send({ success: false, error: 'channel, recipient and a message of at most 4,000 characters are required.' });
    }
    if (!['whatsapp', 'sms', 'voice', 'email'].includes(channel)) {
      return reply.code(400).send({ success: false, error: 'Unsupported communication channel.' });
    }

    if (channel === 'email') {
      const host = process.env.SMTP_HOST?.trim();
      const user = process.env.SMTP_USER?.trim();
      const pass = process.env.SMTP_PASS;
      const from = process.env.SMTP_FROM?.trim();
      if (!host || !user || !pass || !from) {
        return reply.code(503).send({ success: false, error: 'SMTP is not configured.' });
      }
      try {
        const transporter = nodemailer.createTransport({
          host, port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: { user, pass },
        });
        const sent = await transporter.sendMail({ from, to: targetRecipient, subject: subject || 'RyanAI notification', text: message });
        return reply.code(202).send({ success: true, channel, providerId: sent.messageId, status: 'accepted' });
      } catch (error) {
        request.log.error({ err: error }, 'Email provider rejected message');
        return reply.code(502).send({ success: false, error: 'Email provider delivery failed.' });
      }
    }

    const client = twilioClient();
    if (!client) return reply.code(503).send({ success: false, error: 'Twilio is not configured.' });

    if (!E164.test(targetRecipient)) {
      return reply.code(400).send({ success: false, error: 'Recipient must be a valid E.164 phone number.' });
    }

    try {
      if (channel === 'whatsapp' || channel === 'sms') {
        const from = channel === 'whatsapp'
          ? process.env.TWILIO_WHATSAPP_NUMBER?.trim()
          : process.env.TWILIO_PHONE_NUMBER?.trim();
        if (!from) return reply.code(503).send({ success: false, error: `Twilio ${channel} sender is not configured.` });
        const sent = await client.messages.create({
          from: channel === 'whatsapp' && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from,
          to: channel === 'whatsapp' ? `whatsapp:${targetRecipient}` : targetRecipient,
          body: message,
          ...(process.env.TWILIO_STATUS_CALLBACK_URL ? { statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL } : {}),
        });
        return reply.code(202).send({ success: true, channel, providerId: sent.sid, status: sent.status });
      }

      const from = process.env.TWILIO_PHONE_NUMBER?.trim();
      const voiceUrl = process.env.TWILIO_VOICE_WEBHOOK_URL?.trim();
      if (!from || !voiceUrl) return reply.code(503).send({ success: false, error: 'Twilio voice caller ID or voice webhook URL is not configured.' });
      const call = await client.calls.create({
        to: targetRecipient, from, url: voiceUrl, method: 'POST',
        ...(process.env.TWILIO_STATUS_CALLBACK_URL ? { statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL } : {}),
      });
      return reply.code(202).send({ success: true, channel, providerId: call.sid, status: call.status });
    } catch (error) {
      request.log.error({ err: error, channel }, 'Communication provider rejected request');
      return reply.code(502).send({ success: false, error: 'Communication provider request failed.' });
    }
  });

  fastify.get('/api/comms/status', async () => ({
    status: 'configured',
    channels: {
      whatsapp: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER && process.env.TWILIO_WHATSAPP_WEBHOOK_URL),
      sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
      voice: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER && process.env.TWILIO_VOICE_WEBHOOK_URL && process.env.TWILIO_VOICE_ACTION_URL),
      email: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM),
    },
    note: 'Configuration presence only; this endpoint does not claim live provider connectivity.',
  }));

  fastify.post('/api/webhooks/twilio/voice', { preHandler: webhookAuth('TWILIO_VOICE_WEBHOOK_URL') }, async (_request, reply) => {
    reply.type('text/xml');
    return twimlSay('Hello. You are speaking with RyanAI. How can I help you today?');
  });

  fastify.post('/api/webhooks/twilio/voice/respond', { preHandler: webhookAuth('TWILIO_VOICE_ACTION_URL') }, async (request, reply) => {
    const body = request.body as { SpeechResult?: string; CallSid?: string };
    const speech = body.SpeechResult?.trim();
    reply.type('text/xml');
    if (!speech) return twimlSay('I did not catch that. Please try again.', true);
    try {
      const answer = await askRyanAI(speech, `voice_${(body.CallSid || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')}`);
      return twimlSay(answer.slice(0, MAX_MESSAGE_LENGTH), true);
    } catch (error) {
      request.log.error({ err: error }, 'RyanAI voice conversation failed');
      return twimlSay('I am temporarily unable to process that request. Please try again later.', false);
    }
  });

  fastify.post('/api/webhooks/twilio/sms', { preHandler: webhookAuth('TWILIO_SMS_WEBHOOK_URL') }, async (request, reply) => {
    const body = request.body as { From?: string; Body?: string };
    if (!body.From || !body.Body?.trim()) return reply.code(400).send({ error: 'Invalid SMS webhook payload.' });
    reply.type('text/xml');
    try {
      const answer = await askRyanAI(body.Body.trim(), `sms_${body.From.replace(/[^a-zA-Z0-9_-]/g, '')}`);
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(answer.slice(0, 1600))}</Message></Response>`;
    } catch (error) {
      request.log.error({ err: error }, 'RyanAI SMS conversation failed');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>RyanAI is temporarily unavailable. Please try again later.</Message></Response>`;
    }
  });

  fastify.post('/api/webhooks/twilio/status', { preHandler: webhookAuth('TWILIO_STATUS_WEBHOOK_URL') }, async (request) => {
    const body = request.body as Record<string, string>;
    request.log.info({
      providerId: body.MessageSid || body.CallSid,
      status: body.MessageStatus || body.CallStatus,
      errorCode: body.ErrorCode,
    }, 'Twilio delivery status callback');
    return { received: true };
  });
};
