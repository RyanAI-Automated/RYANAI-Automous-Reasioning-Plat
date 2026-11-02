import type { Prisma, PrismaClient } from '@prisma/client';

export type CommunicationChannel = 'whatsapp' | 'sms' | 'voice' | 'email';
export type CommunicationDirection = 'inbound' | 'outbound';

export interface RecordCommunicationInput {
  channel: CommunicationChannel;
  externalAddress: string;
  direction: CommunicationDirection;
  body: string;
  providerMessageId?: string;
  status?: string;
  metadata?: Prisma.InputJsonObject;
}

/** Persist every channel event in one durable, provider-neutral conversation history. */
export async function recordCommunication(
  prisma: PrismaClient,
  input: RecordCommunicationInput,
): Promise<void> {
  const conversation = await prisma.communicationConversation.upsert({
    where: {
      channel_externalAddress: {
        channel: input.channel,
        externalAddress: input.externalAddress,
      },
    },
    create: {
      channel: input.channel,
      externalAddress: input.externalAddress,
    },
    update: { updatedAt: new Date() },
    select: { id: true },
  });

  if (input.providerMessageId) {
    await prisma.communicationMessage.upsert({
      where: { providerMessageId: input.providerMessageId },
      create: {
        conversationId: conversation.id,
        direction: input.direction,
        body: input.body,
        providerMessageId: input.providerMessageId,
        status: input.status ?? 'accepted',
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      update: {
        status: input.status ?? 'accepted',
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
    return;
  }

  await prisma.communicationMessage.create({
    data: {
      conversationId: conversation.id,
      direction: input.direction,
      body: input.body,
      status: input.status ?? 'received',
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  });
}

export async function updateCommunicationStatus(
  prisma: PrismaClient,
  providerMessageId: string,
  status: string,
  metadata?: Prisma.InputJsonObject,
): Promise<void> {
  await prisma.communicationMessage.updateMany({
    where: { providerMessageId },
    data: {
      status,
      ...(metadata ? { metadata } : {}),
    },
  });
}


const INBOUND_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export interface InboundCommunicationClaim {
  claimed: boolean;
  existing?: {
    status: string;
    metadata: Prisma.JsonValue | null;
  };
}

/**
 * Atomically claim a provider webhook event before invoking the agent.
 * Provider IDs are globally unique; the database unique constraint is the
 * concurrency boundary that prevents Twilio/Resend retries from running the
 * same inbound message twice.
 */
export async function claimInboundCommunication(
  prisma: PrismaClient,
  input: Omit<RecordCommunicationInput, 'direction'> & { direction?: 'inbound' },
): Promise<InboundCommunicationClaim> {
  if (!input.providerMessageId) {
    throw new Error('Inbound provider message ID is required for idempotency.');
  }

  const conversation = await prisma.communicationConversation.upsert({
    where: {
      channel_externalAddress: {
        channel: input.channel,
        externalAddress: input.externalAddress,
      },
    },
    create: {
      channel: input.channel,
      externalAddress: input.externalAddress,
    },
    update: { updatedAt: new Date() },
    select: { id: true },
  });

  try {
    await prisma.communicationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'inbound',
        body: input.body,
        providerMessageId: input.providerMessageId,
        status: input.status ?? 'processing',
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
    return { claimed: true };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code !== 'P2002') throw error;

    const existing = await prisma.communicationMessage.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select: { id: true, status: true, metadata: true, createdAt: true },
    });
    if (!existing) throw error;

    // A process can die after claiming a webhook but before completing it.
    // Permit a provider retry to reclaim only an expired processing lease.
    // The conditional update is atomic, so concurrent retries still have one winner.
    const leaseExpired = existing.status === 'processing'
      && existing.createdAt instanceof Date
      && Date.now() - existing.createdAt.getTime() >= INBOUND_PROCESSING_LEASE_MS;
    if (leaseExpired) {
      const reclaimed = await prisma.communicationMessage.updateMany({
        where: {
          id: existing.id,
          status: 'processing',
          createdAt: { lte: new Date(Date.now() - INBOUND_PROCESSING_LEASE_MS) },
        },
        data: {
          status: input.status ?? 'processing',
          body: input.body,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      });
      if (reclaimed.count === 1) return { claimed: true };
    }

    return {
      claimed: false,
      existing: {
        status: existing.status,
        metadata: existing.metadata,
      },
    };
  }
}
