import {
  escapeXml,
  type ActionArgs,
  type ActionTool,
  type CallArgs,
  type EmailArgs,
  type SmsArgs,
  type WhatsAppArgs,
} from './rules.js';
import { prisma } from '../lib/prisma.js';
import { recordCommunication } from '../server/comms/history.js';

async function twilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error('Twilio is not configured on this server.');
  const { default: twilio } = await import('twilio');
  return twilio(accountSid, authToken);
}

async function sendEmail({ to, subject, html }: EmailArgs): Promise<string> {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST;
  if (!user || !pass || !host) throw new Error('SMTP is not configured on this server.');
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host, port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
  const info = await transporter.sendMail({ from: process.env.SMTP_FROM || user, to, subject, html });
  await recordCommunication(prisma, {
    channel: 'email', externalAddress: to.toLowerCase(), direction: 'outbound',
    body: html, providerMessageId: info.messageId, status: 'accepted',
  });
  return `Email accepted by provider. Message id: ${info.messageId}`;
}

async function sendWhatsApp({ to, message }: WhatsAppArgs): Promise<string> {
  const sender = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!sender) throw new Error('TWILIO_WHATSAPP_NUMBER is not set on this server.');
  const client = await twilioClient();
  const contentSid = process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim();
  const result = await client.messages.create({
    from: sender.startsWith('whatsapp:') ? sender : `whatsapp:${sender}`,
    to: `whatsapp:${to}`,
    ...(contentSid ? { contentSid, contentVariables: JSON.stringify({ '1': message }) } : { body: message }),
  });
  await recordCommunication(prisma, {
    channel: 'whatsapp', externalAddress: to, direction: 'outbound',
    body: message, providerMessageId: result.sid, status: result.status,
  });
  return `WhatsApp request accepted. SID: ${result.sid}`;
}

async function sendSms({ to, message }: SmsArgs): Promise<string> {
  const sender = process.env.TWILIO_PHONE_NUMBER;
  if (!sender) throw new Error('TWILIO_PHONE_NUMBER is not set on this server.');
  const client = await twilioClient();
  const result = await client.messages.create({ from: sender, to, body: message });
  await recordCommunication(prisma, {
    channel: 'sms', externalAddress: to, direction: 'outbound',
    body: message, providerMessageId: result.sid, status: result.status,
  });
  return `SMS request accepted. SID: ${result.sid}`;
}

async function placeCall({ to, twimlMessage }: CallArgs): Promise<string> {
  const sender = process.env.TWILIO_PHONE_NUMBER;
  const actionUrl = process.env.TWILIO_VOICE_ACTION_URL?.trim();
  if (!sender) throw new Error('TWILIO_PHONE_NUMBER is not set on this server.');
  if (!actionUrl) throw new Error('TWILIO_VOICE_ACTION_URL is required for two-way AI voice calls.');
  const client = await twilioClient();
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(twimlMessage)}</Say><Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="auto" timeout="5"><Say>Please speak after the tone.</Say></Gather><Say>I did not hear a response. Goodbye.</Say><Hangup/></Response>`;
  const result = await client.calls.create({ twiml, to, from: sender });
  await recordCommunication(prisma, {
    channel: 'voice', externalAddress: to, direction: 'outbound',
    body: twimlMessage, providerMessageId: result.sid, status: result.status,
  });
  return `Conversational voice call started. SID: ${result.sid}`;
}

export async function dispatchAction(tool: ActionTool, args: ActionArgs): Promise<string> {
  switch (tool) {
    case 'send_email': return sendEmail(args as EmailArgs);
    case 'send_whatsapp_message': return sendWhatsApp(args as WhatsAppArgs);
    case 'send_sms_message': return sendSms(args as SmsArgs);
    case 'make_voice_call': return placeCall(args as CallArgs);
  }
}
