import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * Send a WhatsApp message to a number without the `whatsapp:` prefix.
 * Return a confirmation containing the SID, or a failure message if sending throws.
 */
export const sendWhatsAppTool = tool(
  async ({ to, message }) => {
    try {
      const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
      
      const res = await client.messages.create({
        from: fromNumber,
        to: `whatsapp:${to}`,
        body: message,
      });

      return `WhatsApp message sent successfully. SID: ${res.sid}`;
    } catch (err: unknown) {
      return `Failed to send WhatsApp message: ${(err instanceof Error ? err.message : String(err))}`;
    }
  },
  {
    name: 'send_whatsapp_message',
    description: 'Send an outbound WhatsApp message to a user or admin via Twilio.',
    schema: z.object({
      to: z.string().describe('Recipient phone number with country code, e.g. +1234567890'),
      message: z.string().describe('The content of the message to send'),
    }),
  }
);