import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { beginOutboundCommunication, completeOutboundCommunication, markOutboundCommunicationUnknown, OutboundIdempotencyConflictError } from './history.js';
const prisma = {
  communicationConversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }) },
  communicationMessage: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
} as unknown as PrismaClient;
const request = { channel: 'whatsapp' as const, externalAddress: '+27710000000', body: 'Hello Sir', idempotencyKey: 'request-key-00000001' };
afterEach(() => vi.clearAllMocks());
describe('outbound communication idempotency', () => {
  it('reserves a dispatch before contacting a provider', async () => {
    vi.mocked(prisma.communicationMessage.create).mockResolvedValue({ id: 'message-1', status: 'dispatching', providerMessageId: null } as never);
    const result = await beginOutboundCommunication(prisma, request);
    expect(result).toEqual({ id: 'message-1', status: 'dispatching', providerMessageId: null, replayed: false });
    expect(prisma.communicationMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 'conversation-1', direction: 'outbound', body: 'Hello Sir', idempotencyKey: request.idempotencyKey, status: 'dispatching' }),
    }));
  });
  it('returns an existing record rather than dispatching twice', async () => {
    vi.mocked(prisma.communicationMessage.create).mockRejectedValue({ code: 'P2002' });
    vi.mocked(prisma.communicationMessage.findUnique).mockResolvedValue({ id: 'message-1', conversationId: 'conversation-1', direction: 'outbound', body: 'Hello Sir', status: 'accepted', providerMessageId: 'SM-provider-1' } as never);
    await expect(beginOutboundCommunication(prisma, request)).resolves.toMatchObject({ id: 'message-1', status: 'accepted', providerMessageId: 'SM-provider-1', replayed: true });
  });
  it('rejects reuse of a key for a different message or recipient', async () => {
    vi.mocked(prisma.communicationMessage.create).mockRejectedValue({ code: 'P2002' });
    vi.mocked(prisma.communicationMessage.findUnique).mockResolvedValue({ id: 'message-1', conversationId: 'conversation-1', direction: 'outbound', body: 'Different message', status: 'accepted', providerMessageId: 'SM-provider-1' } as never);
    await expect(beginOutboundCommunication(prisma, request)).rejects.toBeInstanceOf(OutboundIdempotencyConflictError);
  });
  it('attaches provider acceptance to the reservation', async () => {
    await completeOutboundCommunication(prisma, { id: 'message-1', providerMessageId: 'SM-provider-2', status: 'queued' });
    expect(prisma.communicationMessage.update).toHaveBeenCalledWith({ where: { id: 'message-1' }, data: { providerMessageId: 'SM-provider-2', status: 'queued' } });
  });
  it('reserves ambiguous outcomes against duplicate retry', async () => {
    await markOutboundCommunicationUnknown(prisma, 'message-1');
    expect(prisma.communicationMessage.update).toHaveBeenCalledWith({ where: { id: 'message-1' }, data: { status: 'dispatch_unknown' } });
  });
});
