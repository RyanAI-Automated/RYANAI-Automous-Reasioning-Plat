import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Single API-owned persistence boundary for user memory.
 * Callers must pass a server-verified principal ID; request/body/model-supplied
 * user IDs are never accepted by this module.
 */
export type MemoryDelegate = PrismaClient['memoryEntry'];

export const memorySelect = {
  id: true,
  key: true,
  value: true,
  category: true,
  createdAt: true,
} as const;

const MEMORY_LIMIT = 50;
const MEMORY_VALUE_LIMIT = 2_000;
const SEARCH_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MemoryPageOptions {
  query?: string;
  limit?: number;
  cursor?: string;
}

export async function listUserMemory(
  memory: MemoryDelegate,
  verifiedUserId: string,
  options: MemoryPageOptions = {},
) {
  const userId = requirePrincipal(verifiedUserId);
  const query = (options.query ?? '').trim();
  if (query.length > SEARCH_LIMIT) throw new Error('Memory search text must be 100 characters or fewer.');
  const limit = options.limit ?? MEMORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Memory page size must be between 1 and 100.');

  const searchFilters: Prisma.MemoryEntryWhereInput[] = query ? [
    { value: { contains: query, mode: 'insensitive' } },
    { category: { contains: query, mode: 'insensitive' } },
    { key: { contains: query, mode: 'insensitive' } },
  ] : [];
  const where: Prisma.MemoryEntryWhereInput = { userId };
  if (searchFilters.length) where.OR = searchFilters;

  if (options.cursor) {
    if (!UUID_PATTERN.test(options.cursor)) throw new Error('Invalid memory page cursor.');
    const cursorWhere: Prisma.MemoryEntryWhereInput = { id: options.cursor, userId };
    if (searchFilters.length) cursorWhere.OR = searchFilters;
    const cursorEntry = await memory.findFirst({
      where: cursorWhere,
      select: { id: true, createdAt: true },
    });
    if (!cursorEntry) throw new Error('Memory page cursor is unavailable for this account.');
    const cursorCreatedAt = cursorEntry.createdAt;
    const afterCursor: Prisma.MemoryEntryWhereInput = cursorCreatedAt === null
      ? { createdAt: null, id: { lt: cursorEntry.id } }
      : { OR: [
          { createdAt: { lt: cursorCreatedAt } },
          { createdAt: cursorCreatedAt, id: { lt: cursorEntry.id } },
          { createdAt: null },
        ] };
    where.AND = [afterCursor];
  }

  const rows = await memory.findMany({
    where,
    orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: limit + 1,
    select: memorySelect,
  });
  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  return { entries, limit, hasMore, nextCursor: hasMore ? entries[entries.length - 1]?.id ?? null : null, query };
}

export async function createUserMemory(
  memory: MemoryDelegate,
  verifiedUserId: string,
  value: string,
  category = 'preference',
) {
  const userId = requirePrincipal(verifiedUserId);
  const normalizedValue = normalizeValue(value);
  const normalizedCategory = normalizeCategory(category);
  return memory.create({
    data: { userId, key: 'vault_' + randomUUID(), value: normalizedValue, category: normalizedCategory },
    select: memorySelect,
  });
}

export async function updateUserMemory(
  memory: MemoryDelegate,
  verifiedUserId: string,
  id: string,
  value: string,
  category = 'preference',
) {
  const userId = requirePrincipal(verifiedUserId);
  if (!UUID_PATTERN.test(id)) throw new Error('Invalid memory entry ID.');
  const normalizedValue = normalizeValue(value);
  const normalizedCategory = normalizeCategory(category);
  const updated = await memory.updateMany({
    where: { id, userId },
    data: { value: normalizedValue, category: normalizedCategory },
  });
  if (updated.count !== 1) return null;
  return memory.findFirst({ where: { id, userId }, select: memorySelect });
}

export async function deleteUserMemory(memory: MemoryDelegate, verifiedUserId: string, id: string) {
  const userId = requirePrincipal(verifiedUserId);
  if (!UUID_PATTERN.test(id)) throw new Error('Invalid memory entry ID.');
  const deleted = await memory.deleteMany({ where: { id, userId } });
  return deleted.count === 1;
}

export async function rememberUserFact(
  memory: MemoryDelegate,
  verifiedUserId: string,
  key: string,
  value: string,
  category = 'preference',
) {
  const userId = requirePrincipal(verifiedUserId);
  const normalizedKey = key.trim();
  if (!normalizedKey || normalizedKey.length > 100) throw new Error('Memory key must be between 1 and 100 characters.');
  const normalizedValue = normalizeValue(value);
  const normalizedCategory = normalizeCategory(category);
  const entry = await memory.upsert({
    where: { userId_key: { userId, key: normalizedKey } },
    create: { userId, key: normalizedKey, value: normalizedValue, category: normalizedCategory },
    update: { value: normalizedValue, category: normalizedCategory },
  });
  return { saved: true, key: entry.key };
}

export async function recallUserFacts(memory: MemoryDelegate, verifiedUserId: string, query: string) {
  const userId = requirePrincipal(verifiedUserId);
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 200) throw new Error('Memory query must be between 1 and 200 characters.');
  const entries = await memory.findMany({
    where: { userId, OR: [
      { key: { contains: normalizedQuery, mode: 'insensitive' } },
      { value: { contains: normalizedQuery, mode: 'insensitive' } },
    ] },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { key: true, value: true, category: true },
  });
  return { query: normalizedQuery, count: entries.length, entries };
}

export async function forgetUserFact(memory: MemoryDelegate, verifiedUserId: string, key: string) {
  const userId = requirePrincipal(verifiedUserId);
  const normalizedKey = key.trim();
  if (!normalizedKey || normalizedKey.length > 100) throw new Error('Memory key must be between 1 and 100 characters.');
  const { count } = await memory.deleteMany({ where: { userId, key: normalizedKey } });
  return { deleted: count };
}

export async function readRecentUserMemory(memory: MemoryDelegate, verifiedUserId: string) {
  const userId = requirePrincipal(verifiedUserId);
  return memory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { key: true, value: true, category: true },
  });
}

function requirePrincipal(userId: string): string {
  const normalized = typeof userId === 'string' ? userId.trim() : '';
  if (!normalized) throw new Error('A server-verified memory principal is required.');
  return normalized;
}

function normalizeValue(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > MEMORY_VALUE_LIMIT) throw new Error('Memory content must be between 1 and 2000 characters.');
  return normalized;
}

function normalizeCategory(category: string): string {
  const normalized = typeof category === 'string' ? category.trim() : '';
  const value = normalized || 'preference';
  if (value.length > 50) throw new Error('Memory category must be 50 characters or fewer.');
  return value;
}

/** Agent-facing entry points keep Prisma ownership inside this API service module. */
async function getMemoryDelegate(): Promise<MemoryDelegate> {
  const { prisma } = await import('../../lib/prisma.js');
  return prisma.memoryEntry;
}

export async function rememberUserFactForPrincipal(userId: string, key: string, value: string, category = 'preference') {
  return rememberUserFact(await getMemoryDelegate(), userId, key, value, category);
}

export async function recallUserFactsForPrincipal(userId: string, query: string) {
  return recallUserFacts(await getMemoryDelegate(), userId, query);
}

export async function forgetUserFactForPrincipal(userId: string, key: string) {
  return forgetUserFact(await getMemoryDelegate(), userId, key);
}

export async function readRecentUserMemoryForPrincipal(userId: string) {
  return readRecentUserMemory(await getMemoryDelegate(), userId);
}
