import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commsPlugin } from './index.js';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    communicationConversation: {
      findMany: vi.fn().mockResolvedValue([{
        id: 'conversation-1', channel: 'whatsapp', externalAddress: '+27710000000',
        updatedAt: new Date('2026-11-03T06:00:00.000Z'),
        messages: [
          { id: 'message-2', direction: 'outbound', body: 'Reply', status: 'sent', providerMessageId: 'SM2', metadata: null, createdAt: new Date('2026-11-03T06:00:02.000Z') },
          { id: 'message-1', direction: 'inbound', body: 'Hello', status: 'received', providerMessageId: 'SM1', metadata: null, createdAt: new Date('2026-11-03T06:00:01.000Z') },
        ],
      }]),
    },
    communicationMessage: { findMany: vi.fn() },
  },
}));

describe('communications history API', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.clearAllMocks();
  });

  async function createApp(isOwner: boolean) {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: 'user-1', role: 'user', isOwner } as never;
    });
    app.decorate('prisma', prisma as never);
    await app.register(commsPlugin);
    return app;
  }

  it('denies non-owner history access', async () => {
    const app = await createApp(false);
    const response = await app.inject({ method: 'GET', url: '/api/comms/conversations' });
    expect(response.statusCode).toBe(403);
    expect(prisma.communicationConversation.findMany).not.toHaveBeenCalled();
  });

  it('returns newest conversations with messages in chronological order', async () => {
    const app = await createApp(true);
    const response = await app.inject({ method: 'GET', url: '/api/comms/conversations?limit=10' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('history');
    expect(body.conversations[0].messages.map((message: { id: string }) => message.id)).toEqual(['message-1', 'message-2']);
    expect(prisma.communicationConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 10, orderBy: { updatedAt: 'desc' },
    }));
  });

  it('caps history limits to protect the database', async () => {
    const app = await createApp(true);
    await app.inject({ method: 'GET', url: '/api/comms/conversations?limit=10000' });
    expect(prisma.communicationConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
