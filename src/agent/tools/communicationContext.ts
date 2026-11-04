import { tool } from '@langchain/core/tools';
import { z } from 'zod';

function ownerAddressCandidates(): string[] {
  const values = new Set<string>();
  const phone = process.env.RYANAI_OWNER_PHONE?.trim();
  if (phone) {
    values.add(phone);
    values.add(phone.replace(/^whatsapp:/i, '').replace(/[^+\d]/g, ''));
  }
  const email = process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase();
  if (email) values.add(email);
  return [...values].filter(Boolean);
}

/**
 * Conversation text is sensitive. Do not make it available to a remote model.
 * This feature is opt-in and accepts only the configured local Ollama endpoint.
 */
export function isLocalCommsMemoryModelConfigured(): boolean {
  if (process.env.RYANAI_COMMS_MEMORY_LOCAL_ONLY !== 'true') return false;
  const endpoint = (process.env.RYANAI_INFERENCE_MODE === 'local'
    ? process.env.OLLAMA_URL
    : process.env.OPENAI_BASE_URL)?.trim();
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'ollama', 'host.docker.internal']);
    return url.protocol === 'http:'
      && localHosts.has(url.hostname.toLowerCase())
      && url.port === '11434'
      && ['', '/', '/v1', '/v1/'].includes(url.pathname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Read a small, owner-scoped cross-channel history window from PostgreSQL.
 * The tool deliberately omits external addresses and provider identifiers.
 */
export const getRecentOwnerCommunicationsTool = tool(
  async ({ limit }) => {
    if (!isLocalCommsMemoryModelConfigured()) {
      return JSON.stringify({
        status: 'blocked',
        reason: 'Cross-channel message content is available only when explicit local-only memory mode is enabled and Ollama is configured on the local 11434 endpoint.',
        conversations: [],
      });
    }

    const addresses = ownerAddressCandidates();
    if (addresses.length === 0) {
      return JSON.stringify({
        status: 'unavailable',
        reason: 'The configured owner communication identity is not available.',
        conversations: [],
      });
    }

    const { prisma } = await import('../../lib/prisma.js');
    const conversations = await prisma.communicationConversation.findMany({
      where: { externalAddress: { in: addresses } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        channel: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: {
            direction: true,
            body: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    return JSON.stringify({
      status: 'ok',
      scope: 'configured_owner_identity_only',
      conversations: conversations.map((conversation) => ({
        channel: conversation.channel,
        updatedAt: conversation.updatedAt,
        messages: [...conversation.messages].reverse(),
      })),
      note: 'This is read-only context from persisted PostgreSQL communication history. It does not send or schedule messages.',
    });
  },
  {
    name: 'get_recent_owner_communications',
    description: 'Read recent WhatsApp, SMS, voice and email history belonging only to the configured RyanAI owner identity. Use this when a follow-up may refer to another channel or an earlier interaction. Read-only; contact addresses and provider identifiers are not returned. Message content is returned only to an explicitly enabled local Ollama model.',
    schema: z.object({
      limit: z.number().int().min(1).max(8).optional().default(5),
    }),
  },
);
