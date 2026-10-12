// File path: ./src/server/comms.ts

import { FastifyPluginAsync } from 'fastify';
import twilio from 'twilio';
import nodemailer from 'nodemailer';

interface WhatsAppBody {
  to: string;
  message: string;
}

interface VoiceCallBody {
  to: string;
  twimlMessage: string;
}

interface EmailBody {
  to: string;
  subject: string;
  html: string;
}

/**
 * Register WhatsApp, voice-call, and SMTP email delivery endpoints.
 * Missing payloads return HTTP 400, unavailable Twilio configuration returns 503,
 * and caught delivery failures become HTTP 500 responses.
 */
export const commsPlugin: FastifyPluginAsync = async (fastify) => {
  // Initialize Twilio Client with safety check
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null;

  // Initialize Nodemailer Transporter
  const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // 1. WhatsApp Endpoint
  fastify.post<{ Body: WhatsAppBody }>('/api/comms/whatsapp', async (request, reply) => {
    const { to, message } = request.body || {};

    if (!to || !message) {
      return reply.status(400).send({ success: false, error: 'Missing "to" or "message" payload parameters.' });
    }

    if (!twilioClient) {
      return reply.status(503).send({ success: false, error: 'Twilio client credentials are not configured on this server.' });
    }

    try {
      const res = await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER!,
        to: `whatsapp:${to}`,
        body: message,
      });
      return { success: true, sid: res.sid, channel: 'whatsapp' };
    } catch (err: unknown) {
      request.log.error(err, 'Failed to dispatch WhatsApp message via Twilio');
      return reply.status(500).send({ success: false, error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // 2. Voice Call Endpoint
  fastify.post<{ Body: VoiceCallBody }>('/api/comms/call', async (request, reply) => {
    const { to, twimlMessage } = request.body || {};

    if (!to || !twimlMessage) {
      return reply.status(400).send({ success: false, error: 'Missing "to" or "twimlMessage" payload parameters.' });
    }

    if (!twilioClient) {
      return reply.status(503).send({ success: false, error: 'Twilio client credentials are not configured on this server.' });
    }

    try {
      const res = await twilioClient.calls.create({
        twiml: `<Response><Say>${twimlMessage}</Say></Response>`,
        to,
        from: process.env.TWILIO_PHONE_NUMBER!,
      });
      return { success: true, sid: res.sid, channel: 'voice_call' };
    } catch (err: unknown) {
      request.log.error(err, 'Failed to initiate outbound voice call via Twilio');
      return reply.status(500).send({ success: false, error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // 3. Email Endpoint
  fastify.post<{ Body: EmailBody }>('/api/comms/email', async (request, reply) => {
    const { to, subject, html } = request.body || {};

    if (!to || !subject || !html) {
      return reply.status(400).send({ success: false, error: 'Missing "to", "subject", or "html" payload parameters.' });
    }

    try {
      const info = await emailTransporter.sendMail({
        from: process.env.SMTP_FROM || 'ryanai@example.com',
        to,
        subject,
        html,
      });
      return { success: true, messageId: info.messageId, channel: 'email' };
    } catch (err: unknown) {
      request.log.error(err, 'Failed to dispatch email via SMTP transporter');
      return reply.status(500).send({ success: false, error: (err instanceof Error ? err.message : String(err)) });
    }
  });
};