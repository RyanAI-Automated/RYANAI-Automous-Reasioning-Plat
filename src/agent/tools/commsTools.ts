import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { dispatchAction } from '../../approvals/dispatch.js';
import { parseActionArgs } from '../../approvals/rules.js';

export const sendWhatsAppTool = tool(
  async ({ to, message }) => dispatchAction('send_whatsapp_message', parseActionArgs('send_whatsapp_message', {
    to: to || process.env.RYANAI_OWNER_PHONE, message,
  })),
  {
    name: 'send_whatsapp_message',
    description: 'Sends an approved WhatsApp message to the owner or a specified recipient.',
    schema: z.object({
      to: z.string().optional().describe('Optional recipient; defaults to the configured owner phone'),
      message: z.string().describe('The WhatsApp message body'),
    }),
  },
);

export const sendSmsTool = tool(
  async ({ to, message }) => dispatchAction('send_sms_message', parseActionArgs('send_sms_message', {
    to: to || process.env.RYANAI_OWNER_PHONE, message,
  })),
  {
    name: 'send_sms_message',
    description: 'Sends an approved SMS to the owner or a specified recipient.',
    schema: z.object({
      to: z.string().optional().describe('Optional recipient; defaults to the configured owner phone'),
      message: z.string().describe('The SMS message body'),
    }),
  },
);

export const makeVoiceCallTool = tool(
  async ({ to, twimlMessage }) => dispatchAction('make_voice_call', parseActionArgs('make_voice_call', {
    to: to || process.env.RYANAI_OWNER_PHONE, twimlMessage,
  })),
  {
    name: 'make_voice_call',
    description: 'Starts an approved two-way AI voice call to the owner or a specified recipient.',
    schema: z.object({
      to: z.string().optional().describe('Optional recipient; defaults to the configured owner phone'),
      twimlMessage: z.string().describe('Opening message to speak before the AI conversation'),
    }),
  },
);

export const sendEmailTool = tool(
  async ({ to, subject, html }) => dispatchAction('send_email', parseActionArgs('send_email', {
    to: to || process.env.RYANAI_OWNER_EMAIL, subject, html,
  })),
  {
    name: 'send_email',
    description: 'Sends an approved email to the owner or a specified recipient.',
    schema: z.object({
      to: z.string().email().optional().describe('Optional recipient; defaults to the configured owner email'),
      subject: z.string().describe('Subject line of the email'),
      html: z.string().describe('HTML or plain text content of the email'),
    }),
  },
);

export const commsTools = [sendWhatsAppTool, sendSmsTool, makeVoiceCallTool, sendEmailTool];
