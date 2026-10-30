import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createPendingAction } from '../../approvals/pendingStore.js';
import { parseActionArgs, type ActionTool } from '../../approvals/rules.js';
import { requireUserId } from './toolContext.js';

async function queueAction(name: ActionTool, args: unknown, config?: RunnableConfig) {
  const userId = requireUserId(config);
  const checked = parseActionArgs(name, args);
  const action = await createPendingAction(userId, name, checked);
  return JSON.stringify({
    status: 'PENDING_APPROVAL',
    id: action.id,
    summary: action.summary,
    expiresAt: action.expiresAt.toISOString(),
    message: 'Nothing has been sent. An administrator must approve this action first. Tell the user that it waits for approval. Do not call this tool again for the same message.',
  });
}

const APPROVAL_NOTE = ' The action is queued, not sent. An administrator must approve it before it goes out.';

export const queueWhatsAppTool = tool(
  async ({ to, message }, config) => queueAction('send_whatsapp_message', { to: to || process.env.RYANAI_OWNER_PHONE, message }, config),
  {
    name: 'send_whatsapp_message',
    description: `Asks to send a WhatsApp message to the owner or a specified number.${APPROVAL_NOTE}`,
    schema: z.object({
      to: z.string().optional().describe('Optional target; defaults to the configured owner phone'),
      message: z.string().describe('The WhatsApp message body'),
    }),
  },
);

export const queueSmsTool = tool(
  async ({ to, message }, config) => queueAction('send_sms_message', { to: to || process.env.RYANAI_OWNER_PHONE, message }, config),
  {
    name: 'send_sms_message',
    description: `Asks to send an SMS to the owner or a specified number.${APPROVAL_NOTE}`,
    schema: z.object({
      to: z.string().optional().describe('Optional target; defaults to the configured owner phone'),
      message: z.string().describe('The SMS message body'),
    }),
  },
);

export const queueVoiceCallTool = tool(
  async ({ to, twimlMessage }, config) => queueAction('make_voice_call', { to: to || process.env.RYANAI_OWNER_PHONE, twimlMessage }, config),
  {
    name: 'make_voice_call',
    description: `Asks to place a two-way AI voice call to the owner or a specified number.${APPROVAL_NOTE}`,
    schema: z.object({
      to: z.string().optional().describe('Optional target; defaults to the configured owner phone'),
      twimlMessage: z.string().describe('Opening message to speak before the AI conversation'),
    }),
  },
);

export const queueEmailTool = tool(
  async ({ to, subject, html }, config) => queueAction('send_email', { to: to || process.env.RYANAI_OWNER_EMAIL, subject, html }, config),
  {
    name: 'send_email',
    description: `Asks to send an email to the owner or a specified address.${APPROVAL_NOTE}`,
    schema: z.object({
      to: z.string().email().optional().describe('Optional recipient; defaults to the configured owner email'),
      subject: z.string().describe('Subject line of the email'),
      html: z.string().describe('HTML or plain text content of the email'),
    }),
  },
);

export const gatedCommsTools = [queueWhatsAppTool, queueSmsTool, queueVoiceCallTool, queueEmailTool];
