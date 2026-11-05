import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface VaultEntry {
  id: string;
  key: string;
  value: string;
  category: string;
  createdAt: string | null;
}

export interface MemoryPage {
  entries: VaultEntry[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  query: string;
}

interface MemoryRow {
  id: string;
  key: string;
  value: string;
  category: string;
  created_at: string | null;
}

const MEMORY_LIMIT = 50;
const MEMORY_VALUE_LIMIT = 2_000;
const SEARCH_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMORY_COLUMNS = 'id,key,value,category,created_at';

function requireClient() {
  if (!supabase) throw new Error('Memory Vault is unavailable because Supabase is not configured.');
  return supabase;
}

async function requireUser(expectedUserId: string): Promise<User> {
  const client = requireClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Please sign in to continue.');
  if (data.user.id !== expectedUserId) throw new Error('Your active account changed. Refresh Memory Vault and try again.');
  return data.user;
}

function mapRow(row: MemoryRow): VaultEntry {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    category: row.category,
    createdAt: row.created_at,
  };
}

/** Escape SQL LIKE metacharacters, then quote the PostgREST filter value. */
function quotedLikePattern(query: string): string {
  const escapedLike = query.replace(/[\\%_]/g, '\\$&');
  const escapedPostgrest = `%${escapedLike}%`
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return `"${escapedPostgrest}"`;
}

export function buildMemorySearchFilter(query: string): string | null {
  const normalized = query.trim();
  if (!normalized) return null;
  if (normalized.length > SEARCH_LIMIT) throw new Error('Search text must be 100 characters or fewer.');
  const pattern = quotedLikePattern(normalized);
  return `value.ilike.${pattern},category.ilike.${pattern},key.ilike.${pattern}`;
}

export function buildMemoryCursorFilter(cursor: { id: string; created_at: string | null }): string | null {
  if (!UUID_PATTERN.test(cursor.id)) throw new Error('Invalid memory page cursor.');
  if (cursor.created_at === null) return null;
  // created_at comes from the database; UUID syntax is validated before use.
  const timestamp = cursor.created_at.replace(/"/g, '\\"');
  return `created_at.lt."${timestamp}",and(created_at.eq."${timestamp}",id.lt.${cursor.id}),created_at.is.null`;
}

export function validateMemoryInput(value: string, category?: string) {
  const normalizedValue = value.trim();
  const normalizedCategory = category?.trim() || 'preference';
  if (!normalizedValue) throw new Error('Memory content cannot be empty.');
  if (normalizedValue.length > MEMORY_VALUE_LIMIT) throw new Error('Memory content must be 2,000 characters or fewer.');
  if (normalizedCategory.length > 50) throw new Error('Memory category must be 50 characters or fewer.');
  return { value: normalizedValue, category: normalizedCategory };
}

export async function listMemory(
  expectedUserId: string,
  options: { query?: string; limit?: number; cursor?: string } = {},
): Promise<MemoryPage> {
  const client = requireClient();
  await requireUser(expectedUserId);

  const query = (options.query || '').trim();
  const searchFilter = buildMemorySearchFilter(query);
  const limit = options.limit ?? MEMORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Page size must be between 1 and 100.');
  }

  if (options.cursor) {
    if (!UUID_PATTERN.test(options.cursor)) throw new Error('Invalid memory page cursor.');
    let cursorQuery = client.from('memory_entries').select('id,created_at').eq('id', options.cursor);
    if (searchFilter) cursorQuery = cursorQuery.or(searchFilter);
    const { data: cursorRow, error: cursorError } = await cursorQuery.maybeSingle();
    if (cursorError) throw new Error('Could not validate the memory page cursor.');
    if (!cursorRow) throw new Error('Memory page cursor is unavailable for this account or search.');
    const row = cursorRow as { id: string; created_at: string | null };
    // RLS scopes this lookup to the verified Supabase user. Never trust a client user_id.
    let pageQuery = client.from('memory_entries').select(MEMORY_COLUMNS);
    if (searchFilter) pageQuery = pageQuery.or(searchFilter);
    if (row.created_at === null) {
      pageQuery = pageQuery.is('created_at', null).lt('id', row.id);
    } else {
      const afterCursor = buildMemoryCursorFilter(row);
      if (afterCursor) pageQuery = pageQuery.or(afterCursor);
    }
    const { data, error } = await pageQuery
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (error) throw new Error('Could not load saved memories.');
    const rows = (data || []) as MemoryRow[];
    const hasMore = rows.length > limit;
    const entries = (hasMore ? rows.slice(0, limit) : rows).map(mapRow);
    return { entries, limit, hasMore, nextCursor: hasMore ? entries.at(-1)?.id ?? null : null, query };
  }

  let pageQuery = client.from('memory_entries').select(MEMORY_COLUMNS);
  if (searchFilter) pageQuery = pageQuery.or(searchFilter);
  const { data, error } = await pageQuery
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error('Could not load saved memories.');
  const rows = (data || []) as MemoryRow[];
  const hasMore = rows.length > limit;
  const entries = (hasMore ? rows.slice(0, limit) : rows).map(mapRow);
  return { entries, limit, hasMore, nextCursor: hasMore ? entries.at(-1)?.id ?? null : null, query };
}

export async function createMemory(expectedUserId: string, input: { value: string; category?: string }) {
  const client = requireClient();
  const user = await requireUser(expectedUserId);
  const normalized = validateMemoryInput(input.value, input.category);
  const { data, error } = await client.from('memory_entries').insert({
    user_id: user.id,
    key: `vault_${crypto.randomUUID()}`,
    value: normalized.value,
    category: normalized.category,
  }).select(MEMORY_COLUMNS).single();
  if (error || !data) throw new Error('Could not save this memory.');
  return mapRow(data as MemoryRow);
}

export async function updateMemory(
  expectedUserId: string,
  id: string,
  input: { value: string; category?: string },
) {
  const client = requireClient();
  await requireUser(expectedUserId);
  if (!UUID_PATTERN.test(id)) throw new Error('Invalid memory entry ID.');
  const normalized = validateMemoryInput(input.value, input.category);
  const { data, error } = await client.from('memory_entries')
    .update({ value: normalized.value, category: normalized.category })
    .eq('id', id)
    .select(MEMORY_COLUMNS)
    .maybeSingle();
  if (error) throw new Error('Could not update this memory.');
  if (!data) throw new Error('Memory entry was not found for this account.');
  return mapRow(data as MemoryRow);
}

export async function deleteMemory(expectedUserId: string, id: string) {
  const client = requireClient();
  await requireUser(expectedUserId);
  if (!UUID_PATTERN.test(id)) throw new Error('Invalid memory entry ID.');
  const { data, error } = await client.from('memory_entries')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error('Could not delete this memory.');
  if (!data) throw new Error('Memory entry was not found for this account.');
  return { deleted: true as const, id: data.id as string };
}
