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
