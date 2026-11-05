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


export class OutboundIdempotencyConflictError extends Error {
  constructor() {
    super('This idempotency key was already used for a different communication request.');
    this.name = 'OutboundIdempotencyConflictError';
  }
}
export interface BeginOutboundCommunicationInput {
  channel: CommunicationChannel;
  externalAddress: string;
  body: string;
  idempotencyKey: string;
  metadata?: Prisma.InputJsonObject;
}
export interface BeginOutboundCommunicationResult {
  id: string;
  status: string;
  providerMessageId: string | null;
  replayed: boolean;
}
/** Reserve an outbound communication before contacting a provider. */
export async function beginOutboundCommunication(
  prisma: PrismaClient,
  input: BeginOutboundCommunicationInput,
): Promise<BeginOutboundCommunicationResult> {
  const conversation = await prisma.communicationConversation.upsert({
    where: { channel_externalAddress: { channel: input.channel, externalAddress: input.externalAddress } },
    create: { channel: input.channel, externalAddress: input.externalAddress },
    update: { updatedAt: new Date() },
    select: { id: true },
  });
  try {
    const created = await prisma.communicationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'outbound',
        body: input.body,
        idempotencyKey: input.idempotencyKey,
        status: 'dispatching',
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      select: { id: true, status: true, providerMessageId: true },
    });
    return { id: created.id, status: created.status, providerMessageId: created.providerMessageId, replayed: false };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code : undefined;
    if (code !== 'P2002') throw error;
    const existing = await prisma.communicationMessage.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, conversationId: true, direction: true, body: true, status: true, providerMessageId: true },
    });
    if (!existing) throw error;
    if (existing.conversationId !== conversation.id || existing.direction !== 'outbound' || existing.body !== input.body) {
      throw new OutboundIdempotencyConflictError();
    }
    return { id: existing.id, status: existing.status, providerMessageId: existing.providerMessageId, replayed: true };
  }
}
/** Attach provider acceptance to the pre-existing outbound reservation. */
export async function completeOutboundCommunication(
  prisma: PrismaClient,
  input: { id: string; providerMessageId: string; status: string },
): Promise<void> {
  await prisma.communicationMessage.update({
    where: { id: input.id },
    data: { providerMessageId: input.providerMessageId, status: input.status },
  });
}
/** Keep ambiguous outcomes reserved instead of risking a duplicate dispatch. */
export async function markOutboundCommunicationUnknown(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.communicationMessage.update({ where: { id }, data: { status: 'dispatch_unknown' } });
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
