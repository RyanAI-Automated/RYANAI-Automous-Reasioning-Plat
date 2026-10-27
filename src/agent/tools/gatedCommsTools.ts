import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createPendingAction } from '../../approvals/pendingStore.js';
import { parseActionArgs, type ActionTool } from '../../approvals/rules.js';
import { requireUserId } from './toolContext.js';

/**
 * Queue an outbound action for approval. These tools never send anything.
 * An administrator approves the action through /api/actions, and only then does
 * the server send it.
 */
async function queueAction(name: ActionTool, args: unknown, config?: RunnableConfig) {
  const userId = requireUserId(config);
  const checked = parseActionArgs(name, args);
  const action = await createPendingAction(userId, name, checked);
  return JSON.stringify({
    status: 'PENDING_APPROVAL',
    id: action.id,
    summary: action.summary,
    expiresAt: action.expiresAt.toISOString(),
    message:
      'Nothing has been sent. An administrator must approve this action first. Tell the user that it waits for approval. Do not call this tool again for the same message.',
  });
}

const APPROVAL_NOTE =
  ' The action is queued, not sent. An administrator must approve it before it goes out.';

export const queueWhatsAppTool = tool(
  async ({ to, message }, config) => queueAction('send_whatsapp_message', { to, message }, config),
  {
    name: 'send_whatsapp_message',
    description: `Asks to send a WhatsApp text message to a phone number.${APPROVAL_NOTE}`,
    schema: z.object({
      to: z.string().describe('Target phone number with country code, e.g. +1234567890'),
      message: z.string().describe('The body text of the WhatsApp message'),
    }),
  },
);

export const queueVoiceCallTool = tool(
  async ({ to, twimlMessage }, config) => queueAction('make_voice_call', { to, twimlMessage }, config),
  {
    name: 'make_voice_call',
    description: `Asks to place a voice call that reads out a short script.${APPROVAL_NOTE}`,
    schema: z.object({
      to: z.string().describe('Target phone number with country code'),
      twimlMessage: z.string().describe('Plain text for the automated voice to speak on the call'),
    }),
  },
);

export const queueEmailTool = tool(
  async ({ to, subject, html }, config) => queueAction('send_email', { to, subject, html }, config),
  {
    name: 'send_email',
    description: `Asks to send an email with an optional HTML body.${APPROVAL_NOTE}`,
    schema: z.object({
      to: z.string().email().describe('Recipient email address'),
      subject: z.string().describe('Subject line of the email'),
      html: z.string().describe('HTML or plain text content of the email'),
    }),
  },
);

export const gatedCommsTools = [queueWhatsAppTool, queueVoiceCallTool, queueEmailTool];
