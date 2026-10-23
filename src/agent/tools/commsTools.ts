import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

export const sendWhatsAppTool = tool(
  async ({ to, message }) => {
    const res = await fetch(`${API_BASE_URL}/api/comms/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message }),
    });
    const data = await res.json();
    return JSON.stringify(data);
  },
  {
    name: 'send_whatsapp_message',
    description: 'Sends a WhatsApp text message to a specified recipient phone number.',
    schema: z.object({
      to: z.string().describe('Target phone number with country code, e.g. +1234567890'),
      message: z.string().describe('The body text of the WhatsApp message to dispatch'),
    }),
  }
);

export const makeVoiceCallTool = tool(
  async ({ to, twimlMessage }) => {
    const res = await fetch(`${API_BASE_URL}/api/comms/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, twimlMessage }),
    });
    const data = await res.json();
    return JSON.stringify(data);
  },
  {
    name: 'make_voice_call',
    description: 'Places a voice call to a phone number and reads out the given speech script.',
    schema: z.object({
      to: z.string().describe('Target phone number with country code'),
      twimlMessage: z.string().describe('Text script for the automated voice to speak on the call'),
    }),
  }
);

export const sendEmailTool = tool(
  async ({ to, subject, html }) => {
    const res = await fetch(`${API_BASE_URL}/api/comms/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html }),
    });
    const data = await res.json();
    return JSON.stringify(data);
  },
  {
    name: 'send_email',
    description: 'Sends an email with an optional HTML message body.',
    schema: z.object({
      to: z.string().email().describe('Recipient email address'),
      subject: z.string().describe('Subject line of the email'),
      html: z.string().describe('HTML or plain text content of the email'),
    }),
  }
);

export const commsTools = [sendWhatsAppTool, makeVoiceCallTool, sendEmailTool];