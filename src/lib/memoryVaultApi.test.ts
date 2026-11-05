import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  },
}));

import {
  buildMemoryCursorFilter,
  buildMemorySearchFilter,
  listMemory,
  validateMemoryInput,
} from './memoryVaultApi';

const userId = '10000000-0000-4000-8000-000000000001';
const cursorId = '20000000-0000-4000-8000-000000000002';
const cursorTime = '2026-11-05T10:00:00.000Z';

function queryBuilder(result: { data: unknown; error: null }) {
  const builder: Record<string, any> = {};
  for (const method of ['select', 'eq', 'or', 'is', 'lt', 'order', 'insert', 'update', 'delete']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.limit = vi.fn(async () => result);
  return builder;
}

describe('Memory Vault Supabase Data API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  });

  it('builds a quoted, literal substring filter across value, category and key', () => {
    expect(buildMemorySearchFilter('  project  ')).toBe(
      'value.ilike."%project%",category.ilike."%project%",key.ilike."%project%"',
    );
    const hostile = buildMemorySearchFilter('a,b%)._(c)');
    expect(hostile).toContain('value.ilike.');
    expect(hostile).toContain('category.ilike.');
    expect(hostile).toContain('key.ilike.');
    expect(hostile).not.toContain('a,b%)._(c)');
    expect(buildMemorySearchFilter('   ')).toBeNull();
    expect(() => buildMemorySearchFilter('x'.repeat(101))).toThrow(/100 characters/);
  });

  it('preserves descending timestamp and ID ordering, including null timestamps', () => {
    expect(buildMemoryCursorFilter({ id: cursorId, created_at: cursorTime })).toBe(
      `created_at.lt."${cursorTime}",and(created_at.eq."${cursorTime}",id.lt.${cursorId}),created_at.is.null`,
    );
    expect(buildMemoryCursorFilter({ id: cursorId, created_at: null })).toBeNull();
    expect(() => buildMemoryCursorFilter({ id: 'not-a-uuid', created_at: cursorTime })).toThrow(/cursor/);
  });

  it('validates content and category without accepting blank values', () => {
    expect(validateMemoryInput('  fact  ', '  project  ')).toEqual({ value: 'fact', category: 'project' });
    expect(validateMemoryInput('fact')).toEqual({ value: 'fact', category: 'preference' });
    expect(() => validateMemoryInput('   ')).toThrow(/cannot be empty/);
    expect(() => validateMemoryInput('x'.repeat(2001))).toThrow(/2,000/);
    expect(() => validateMemoryInput('fact', 'x'.repeat(51))).toThrow(/50 characters/);
  });

  it('requires the authenticated Supabase identity to match the active UI account', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: '10000000-0000-4000-8000-000000000009' } }, error: null });
    await expect(listMemory(userId)).rejects.toThrow(/active account changed/);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('uses the signed-in Supabase session and stable keyset pagination without trusting a client user_id', async () => {
    const rows = [
      { id: cursorId, key: 'vault_a', value: 'first', category: 'note', created_at: cursorTime },
      { id: '30000000-0000-4000-8000-000000000003', key: 'vault_b', value: 'second', category: 'note', created_at: cursorTime },
    ];
    const builder = queryBuilder({ data: rows, error: null });
    mocks.from.mockReturnValue(builder);

    const page = await listMemory(userId, { query: 'note', limit: 1 });

    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith('memory_entries');
    expect(builder.or).toHaveBeenCalledWith(
      'value.ilike."%note%",category.ilike."%note%",key.ilike."%note%"',
    );
    expect(builder.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false, nullsFirst: false });
    expect(builder.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(2);
    expect(page).toMatchObject({
      limit: 1,
      hasMore: true,
      nextCursor: cursorId,
      query: 'note',
      entries: [{ id: cursorId, createdAt: cursorTime }],
    });
    // The client never supplies user_id as a filter; Postgres RLS applies auth.uid().
    expect(builder.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });

  it('validates a page cursor under RLS and applies the after-cursor predicate', async () => {
    const cursorLookup = queryBuilder({ data: { id: cursorId, created_at: cursorTime }, error: null });
    const pageQuery = queryBuilder({
      data: [{ id: '30000000-0000-4000-8000-000000000003', key: 'vault_b', value: 'next', category: 'note', created_at: cursorTime }],
      error: null,
    });
    mocks.from.mockReturnValueOnce(cursorLookup).mockReturnValueOnce(pageQuery);

    const page = await listMemory(userId, { cursor: cursorId, limit: 10, query: 'note' });

    expect(cursorLookup.eq).toHaveBeenCalledWith('id', cursorId);
    expect(cursorLookup.or).toHaveBeenCalledWith(
      'value.ilike."%note%",category.ilike."%note%",key.ilike."%note%"',
    );
    expect(pageQuery.or).toHaveBeenNthCalledWith(1,
      'value.ilike."%note%",category.ilike."%note%",key.ilike."%note%"',
    );
    expect(pageQuery.or).toHaveBeenNthCalledWith(2,
      `created_at.lt."${cursorTime}",and(created_at.eq."${cursorTime}",id.lt.${cursorId}),created_at.is.null`,
    );
    expect(page.entries).toHaveLength(1);
  });

  it('paginates null timestamps by ID after the null-timestamp cursor', async () => {
    const cursorLookup = queryBuilder({ data: { id: cursorId, created_at: null }, error: null });
    const pageQuery = queryBuilder({ data: [], error: null });
    mocks.from.mockReturnValueOnce(cursorLookup).mockReturnValueOnce(pageQuery);

    await listMemory(userId, { cursor: cursorId });

    expect(pageQuery.is).toHaveBeenCalledWith('created_at', null);
    expect(pageQuery.lt).toHaveBeenCalledWith('id', cursorId);
  });
});
