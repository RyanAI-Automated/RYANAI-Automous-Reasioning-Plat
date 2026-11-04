import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getRecentOwnerCommunicationsTool } from './communicationContext.js';

const channels = ['whatsapp', 'sms', 'voice', 'email'] as const;
type CommunicationChannel = typeof channels[number];

const channelPolicy: Record<CommunicationChannel, string[]> = {
  whatsapp: [
    'Use an approved WhatsApp template when required by the provider conversation window.',
    'Respect recipient opt-in and opt-out requests.',
  ],
  sms: [
    'Use an E.164 recipient number.',
    'Respect recipient consent, quiet hours and opt-out requests.',
  ],
  voice: [
    'Use an E.164 recipient number.',
    'Calls require explicit owner approval and must respect consent and quiet hours.',
  ],
  email: [
    'Use a valid email recipient address.',
    'Do not claim delivery based only on SMTP provider acceptance.',
  ],
};

export const getCommunicationPolicyTool = tool(
  async ({ channel }) => JSON.stringify({
    channel,
    policy: channelPolicy[channel],
    execution: 'disabled_in_agent_tool_registry',
    approvalRequired: true,
    note: 'This tool only explains channel policy. It cannot contact a recipient or access provider credentials.',
  }),
  {
    name: 'get_communication_policy',
    description: 'Read the safety and consent policy for one RyanAI communications channel. This is read-only and never sends a message or places a call.',
    schema: z.object({
      channel: z.enum(channels),
    }),
  },
);

export const prepareCommunicationDraftTool = tool(
  async ({ channel, recipient, subject, message }) => JSON.stringify({
    status: 'draft_ready',
    channel,
    recipient,
    ...(channel === 'email' ? { subject: subject ?? 'RyanAI message' } : {}),
    message,
    approvalRequired: true,
    dispatchPerformed: false,
    nextStep: 'Present this exact draft to the owner for explicit approval. Do not claim it was sent.',
  }),
  {
    name: 'prepare_communication_draft',
    description: 'Prepare a WhatsApp, SMS, voice script or email draft for owner review. This tool has no network access and cannot send, schedule or place calls.',
    schema: z.object({
      channel: z.enum(channels),
      recipient: z.string().trim().min(1).max(320),
      subject: z.string().trim().max(200).optional(),
      message: z.string().trim().min(1).max(4000),
    }).superRefine((value, context) => {
      if (value.channel === 'email' && !z.string().email().safeParse(value.recipient).success) {
        context.addIssue({
          code: 'custom',
          path: ['recipient'],
          message: 'Email drafts require a valid email address.',
        });
      }
      if (value.channel !== 'email' && !/^\+[1-9]\d{7,14}$/.test(value.recipient)) {
        context.addIssue({
          code: 'custom',
          path: ['recipient'],
          message: 'Phone-based channel drafts require an E.164 recipient number.',
        });
      }
      if (value.channel !== 'email' && value.subject) {
        context.addIssue({
          code: 'custom',
          path: ['subject'],
          message: 'A subject is only supported for email drafts.',
        });
      }
    }),
  },
);

/** Policy, draft and owner-scoped read-only context only; provider actions stay outside this registry. */
export const commsTools = [
  getCommunicationPolicyTool,
  getRecentOwnerCommunicationsTool,
  prepareCommunicationDraftTool,
];
