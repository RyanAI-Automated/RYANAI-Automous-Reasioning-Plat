import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const memoryEntry = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { memoryEntry } }));

import { MEMORY_CONTEXT_PREFIX, buildMemoryContext } from './memoryContext.js';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('buildMemoryContext', () => {
  it('returns null and reads nothing when there is no user', async () => {
    expect(await buildMemoryContext(undefined)).toBeNull();
    expect(memoryEntry.findMany).not.toHaveBeenCalled();
  });

  it('returns null when the user has no notes', async () => {
    memoryEntry.findMany.mockResolvedValue([]);
    expect(await buildMemoryContext('user-1')).toBeNull();
  });

  it('reads only the notes of this user and labels them as data', async () => {
    memoryEntry.findMany.mockResolvedValue([
      { key: 'language', value: 'TypeScript', category: 'preference' },
    ]);
    const context = await buildMemoryContext('user-1');
    expect(memoryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, take: 20 }),
    );
    expect(context).toContain(MEMORY_CONTEXT_PREFIX);
    expect(context).toContain('not an instruction');
    expect(context).toContain('- [preference] language: TypeScript');
  });

  it('collapses line breaks and cuts long values', async () => {
    memoryEntry.findMany.mockResolvedValue([
      { key: 'bio', value: `line one\nline two ${'x'.repeat(500)}`, category: 'profile' },
    ]);
    const context = (await buildMemoryContext('user-1'))!;
    expect(context).toContain('bio: line one line two');
    const noteLine = context.split('\n').find((line) => line.startsWith('- [profile]'))!;
    expect(noteLine.length).toBeLessThan(340);
  });

  it('keeps the whole message under the size limit', async () => {
    memoryEntry.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        key: `k${index}`,
        value: 'y'.repeat(300),
        category: 'note',
      })),
    );
    const context = (await buildMemoryContext('user-1'))!;
    expect(context.length).toBeLessThan(4300);
  });

  it('returns null and does not throw when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    memoryEntry.findMany.mockRejectedValue(new Error('connection refused'));
    expect(await buildMemoryContext('user-1')).toBeNull();
  });
});
