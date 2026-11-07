import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
}));

import { memoryRoutes } from './memory.js';

const memoryId = '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11';
const sampleEntry = {
  id: memoryId,
  key: 'vault_test-key',
  value: 'Prefer concise project summaries.',
  category: 'preference',
  createdAt: new Date('2026-11-05T10:00:00.000Z'),
};

const apps: FastifyInstance[] = [];

async function createApp() {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('authUser', null);
  app.decorate('prisma', { memoryEntry: store } as unknown as PrismaClient);
  // The route guard consumes this verified test identity; no browser metadata is trusted.
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    if (typeof id === 'string' && id.length > 0) {
      request.authUser = { id, role: 'user', isOwner: false };
    }
  });
  await app.register(memoryRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.findMany.mockResolvedValue([sampleEntry]);
  store.create.mockResolvedValue(sampleEntry);
  store.updateMany.mockResolvedValue({ count: 1 });
  store.findFirst.mockResolvedValue(sampleEntry);
  store.deleteMany.mockResolvedValue({ count: 1 });
});

afterAll(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('account-scoped Postgres Memory Vault API', () => {
  it('rejects anonymous reads before querying memory', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/api/user/memory' });
    expect(response.statusCode).toBe(401);
    expect(store.findMany).not.toHaveBeenCalled();
  });

  it('lists only the verified account entries and bounds the result set', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/user/memory',
      headers: { 'x-test-user': 'user-a' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toHaveLength(1);
    expect(store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-a' },
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: 51,
    }));
  });

  it('creates a memory owned by the verified account and returns the persisted row', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/user/memory',
      headers: { 'x-test-user': 'user-a' },
      payload: { value: 'Prefer concise project summaries.', category: 'preference' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().entry).toMatchObject({ id: memoryId, value: sampleEntry.value });
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-a',
        value: sampleEntry.value,
        category: 'preference',
      }),
    }));
    const createArgs = store.create.mock.calls[0][0];
    expect(createArgs.data.key).toMatch(/^vault_[0-9a-f-]{36}$/i);
  });

  it('updates by both entry ID and account ID, preventing cross-account edits', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/user/memory/' + memoryId,
      headers: { 'x-test-user': 'user-a' },
      payload: { value: 'Updated memory', category: 'project' },
    });
    expect(response.statusCode).toBe(200);
    expect(store.updateMany).toHaveBeenCalledWith({
      where: { id: memoryId, userId: 'user-a' },
      data: { value: 'Updated memory', category: 'project' },
    });
    expect(store.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: memoryId, userId: 'user-a' },
    }));
  });

  it('returns not found when the entry belongs to another account', async () => {
    store.updateMany.mockResolvedValue({ count: 0 });
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/user/memory/' + memoryId,
      headers: { 'x-test-user': 'user-b' },
      payload: { value: 'Attempted cross-account update' },
    });
    expect(response.statusCode).toBe(404);
    expect(store.findFirst).not.toHaveBeenCalled();
  });

  it('deletes by both entry ID and account ID', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/user/memory/' + memoryId,
      headers: { 'x-test-user': 'user-a' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ deleted: true, id: memoryId });
    expect(store.deleteMany).toHaveBeenCalledWith({
      where: { id: memoryId, userId: 'user-a' },
    });
  });


  it('accepts uppercase hexadecimal UUIDs on the delete route', async () => {
    const app = await createApp();
    const uppercaseId = memoryId.toUpperCase();
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/user/memory/' + uppercaseId,
      headers: { 'x-test-user': 'user-a' },
    });
    expect(response.statusCode).toBe(200);
    expect(store.deleteMany).toHaveBeenCalledWith({
      where: { id: uppercaseId, userId: 'user-a' },
    });
  });

  it('rejects malformed IDs and empty memory content', async () => {
    const app = await createApp();
    const invalidId = await app.inject({
      method: 'DELETE',
      url: '/api/user/memory/not-a-uuid',
      headers: { 'x-test-user': 'user-a' },
    });
    const empty = await app.inject({
      method: 'POST',
      url: '/api/user/memory',
      headers: { 'x-test-user': 'user-a' },
      payload: { value: '   ' },
    });
    expect(invalidId.statusCode).toBe(400);
    expect(empty.statusCode).toBe(400);
    expect(store.deleteMany).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });
  it('filters search results within the authenticated account', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/user/memory?q=PROJECT&limit=25',
      headers: { 'x-test-user': 'user-a' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ query: 'PROJECT', limit: 25, hasMore: false, nextCursor: null });
    expect(store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-a',
        OR: [
          { value: { contains: 'PROJECT', mode: 'insensitive' } },
          { category: { contains: 'PROJECT', mode: 'insensitive' } },
          { key: { contains: 'PROJECT', mode: 'insensitive' } },
        ],
      },
      take: 26,
    }));
  });

  it('uses an account-owned cursor and returns the next cursor when another page exists', async () => {
    store.findMany.mockResolvedValue([sampleEntry, { ...sampleEntry, id: '8b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c12' }]);
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/user/memory?limit=1&cursor=' + memoryId,
      headers: { 'x-test-user': 'user-a' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ hasMore: true, nextCursor: memoryId });
    expect(store.findFirst).toHaveBeenCalledWith({
      where: { id: memoryId, userId: 'user-a' },
      select: { id: true, createdAt: true },
    });
    expect(store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-a',
        AND: [{ OR: [
          { createdAt: { lt: sampleEntry.createdAt } },
          { createdAt: sampleEntry.createdAt, id: { lt: memoryId } },
          { createdAt: null },
        ] }],
      },
      take: 2,
    }));
  });

  it('paginates null timestamps after dated memory entries without comparing null as a date', async () => {
    store.findFirst.mockResolvedValue({ ...sampleEntry, createdAt: null });
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/user/memory?cursor=' + memoryId,
      headers: { 'x-test-user': 'user-a' },
    });
    expect(response.statusCode).toBe(200);
    expect(store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-a',
        AND: [{ createdAt: null, id: { lt: memoryId } }],
      },
      orderBy: [
        { createdAt: { sort: 'desc', nulls: 'last' } },
        { id: 'desc' },
      ],
    }));
  });

  it('rejects a cursor that does not belong to the active search result set', async () => {
    store.findFirst.mockResolvedValue(null);
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/user/memory?q=PROJECT&cursor=' + memoryId,
      headers: { 'x-test-user': 'user-a' },
    });
    expect(response.statusCode).toBe(400);
    expect(store.findFirst).toHaveBeenCalledWith({
      where: {
        id: memoryId,
        userId: 'user-a',
        OR: [
          { value: { contains: 'PROJECT', mode: 'insensitive' } },
          { category: { contains: 'PROJECT', mode: 'insensitive' } },
          { key: { contains: 'PROJECT', mode: 'insensitive' } },
        ],
      },
      select: { id: true, createdAt: true },
    });
    expect(store.findMany).not.toHaveBeenCalled();
  });

  it('rejects a cursor that is not owned by the authenticated account', async () => {
    store.findFirst.mockResolvedValue(null);
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/user/memory?cursor=' + memoryId,
      headers: { 'x-test-user': 'user-b' },
    });
    expect(response.statusCode).toBe(400);
    expect(store.findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid page sizes and oversized search queries', async () => {
    const app = await createApp();
    const invalidLimit = await app.inject({
      method: 'GET', url: '/api/user/memory?limit=500',
      headers: { 'x-test-user': 'user-a' },
    });
    const invalidQuery = await app.inject({
      method: 'GET', url: '/api/user/memory?q=' + 'x'.repeat(101),
      headers: { 'x-test-user': 'user-a' },
    });
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidQuery.statusCode).toBe(400);
    expect(store.findMany).not.toHaveBeenCalled();
  });

});
