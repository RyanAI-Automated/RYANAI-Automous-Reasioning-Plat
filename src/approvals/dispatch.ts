import {
  escapeXml,
  type ActionArgs,
  type ActionTool,
  type CallArgs,
  type EmailArgs,
  type WhatsAppArgs,
} from './rules.js';

/** Create a Twilio client on first use, so a server without Twilio still starts. */
async function twilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error('Twilio is not configured on this server.');
  }
  const { default: twilio } = await import('twilio');
  return twilio(accountSid, authToken);
}

async function sendEmail({ to, subject, html }: EmailArgs): Promise<string> {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error('SMTP is not configured on this server.');
  }
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user, pass },
  });
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || user,
    to,
    subject,
    html,
  });
  return `Email sent. Message id: ${info.messageId}`;
}

async function sendWhatsApp({ to, message }: WhatsAppArgs): Promise<string> {
  const sender = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!sender) {
    throw new Error('TWILIO_WHATSAPP_NUMBER is not set on this server.');
  }
  const client = await twilioClient();
  const result = await client.messages.create({
    from: sender.startsWith('whatsapp:') ? sender : `whatsapp:${sender}`,
    to: `whatsapp:${to}`,
    body: message,
  });
  return `WhatsApp message sent. SID: ${result.sid}`;
}

async function placeCall({ to, twimlMessage }: CallArgs): Promise<string> {
  const sender = process.env.TWILIO_PHONE_NUMBER;
  if (!sender) {
    throw new Error('TWILIO_PHONE_NUMBER is not set on this server.');
  }
  const client = await twilioClient();
  const result = await client.calls.create({
    twiml: `<Response><Say>${escapeXml(twimlMessage)}</Say></Response>`,
    to,
    from: sender,
  });
  return `Voice call started. SID: ${result.sid}`;
}

/**
 * Send an approved action through Twilio or SMTP. Only the approval service
 * calls this function, after it checks the arguments again. Errors go to the caller.
 */
export async function dispatchAction(tool: ActionTool, args: ActionArgs): Promise<string> {
  switch (tool) {
    case 'send_email':
      return sendEmail(args as EmailArgs);
    case 'send_whatsapp_message':
      return sendWhatsApp(args as WhatsAppArgs);
    case 'make_voice_call':
      return placeCall(args as CallArgs);
  }
}
