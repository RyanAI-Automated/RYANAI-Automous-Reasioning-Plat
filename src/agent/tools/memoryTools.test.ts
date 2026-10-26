import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryEntry = vi.hoisted(() => ({
  upsert: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: { memoryEntry } }));

import {
  forgetMemoryTool,
  recallMemoryTool,
  rememberFactTool,
} from './memoryTools.js';

const asUser = { configurable: { userId: 'user-1' } };

beforeEach(() => vi.clearAllMocks());

describe('memory tools', () => {
  it('saves a fact for the signed-in user only', async () => {
    memoryEntry.upsert.mockResolvedValue({ key: 'language' });
    await rememberFactTool.invoke(
      { key: 'language', value: 'TypeScript', category: 'preference' },
      asUser,
    );
    expect(memoryEntry.upsert).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'user-1', key: 'language' } },
      create: { userId: 'user-1', key: 'language', value: 'TypeScript', category: 'preference' },
      update: { value: 'TypeScript', category: 'preference' },
    });
  });

  it('searches only the memory of the signed-in user', async () => {
    memoryEntry.findMany.mockResolvedValue([]);
    await recallMemoryTool.invoke({ query: 'type' }, asUser);
    expect(memoryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
        take: 10,
      }),
    );
  });

  it('deletes only the entry of the signed-in user', async () => {
    memoryEntry.deleteMany.mockResolvedValue({ count: 1 });
    const result = await forgetMemoryTool.invoke({ key: 'language' }, asUser);
    expect(memoryEntry.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', key: 'language' },
    });
    expect(JSON.parse(result)).toEqual({ deleted: 1 });
  });

  it('fails without an authenticated user and does not touch the database', async () => {
    await expect(recallMemoryTool.invoke({ query: 'type' })).rejects.toThrow(
      /authenticated user/,
    );
    expect(memoryEntry.findMany).not.toHaveBeenCalled();
  });
});
