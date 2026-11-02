import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { claimInboundCommunication } from './history.js';

function prismaMock(create: ReturnType<typeof vi.fn>, findUnique = vi.fn()) {
  return {
    communicationConversation: {
      upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }),
    },
    communicationMessage: { create, findUnique, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as PrismaClient;
}

const input = {
  channel: 'whatsapp' as const,
  externalAddress: '+27718095084',
  body: 'Hello RyanAI',
  providerMessageId: 'SM-provider-event-1',
  status: 'processing',
};

describe('claimInboundCommunication', () => {
  it('claims a new provider event before agent processing', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'message-1' });
    const prisma = prismaMock(create);

    await expect(claimInboundCommunication(prisma, input)).resolves.toEqual({ claimed: true });
    expect(create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conversation-1',
        direction: 'inbound',
        body: 'Hello RyanAI',
        providerMessageId: 'SM-provider-event-1',
        status: 'processing',
      },
    });
  });

  it('returns the existing event after a concurrent or retried provider delivery', async () => {
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const findUnique = vi.fn().mockResolvedValue({
      status: 'replied',
      metadata: { reply: 'Certainly, Sir.' },
    });
    const prisma = prismaMock(create, findUnique);

    await expect(claimInboundCommunication(prisma, input)).resolves.toEqual({
      claimed: false,
      existing: { status: 'replied', metadata: { reply: 'Certainly, Sir.' } },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { providerMessageId: 'SM-provider-event-1' },
      select: { status: true, metadata: true },
    });
  });

  it('reclaims a processing claim whose lease expired after a worker crash', async () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000);
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const findUnique = vi.fn().mockResolvedValue({
      id: 'message-stale', status: 'processing', metadata: null, createdAt: stale,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      communicationConversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }) },
      communicationMessage: { create, findUnique, updateMany },
    } as unknown as PrismaClient;

    await expect(claimInboundCommunication(prisma, input)).resolves.toEqual({ claimed: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'message-stale', status: 'processing' }),
      data: expect.objectContaining({ status: 'processing', body: input.body }),
    }));
  });

  it('does not reclaim a fresh processing claim while another worker may own it', async () => {
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const findUnique = vi.fn().mockResolvedValue({
      id: 'message-fresh', status: 'processing', metadata: null, createdAt: new Date(),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      communicationConversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }) },
      communicationMessage: { create, findUnique, updateMany },
    } as unknown as PrismaClient;

    await expect(claimInboundCommunication(prisma, input)).resolves.toEqual({
      claimed: false, existing: { status: 'processing', metadata: null },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not disguise database failures as duplicate deliveries', async () => {
    const failure = new Error('database unavailable');
    const create = vi.fn().mockRejectedValue(failure);
    const findUnique = vi.fn();
    const prisma = prismaMock(create, findUnique);

    await expect(claimInboundCommunication(prisma, input)).rejects.toBe(failure);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('requires a provider event ID to guarantee idempotency', async () => {
    const prisma = prismaMock(vi.fn());
    await expect(
      claimInboundCommunication(prisma, { ...input, providerMessageId: undefined }),
    ).rejects.toThrow('Inbound provider message ID is required for idempotency.');
  });
});
