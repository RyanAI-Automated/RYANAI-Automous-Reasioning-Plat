import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { requireUser } from './auth.js';

const MEMORY_LIMIT = 50;
const MEMORY_VALUE_LIMIT = 2_000;
const SEARCH_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const memorySelect = {
  id: true,
  key: true,
  value: true,
  category: true,
  createdAt: true,
} as const;

/**
 * Account-scoped interface to the same Postgres MemoryEntry table used by
 * remember_fact, recall_memory and the reasoning memory-context builder.
 */
export const memoryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);

  fastify.get<{ Querystring: { q?: string; limit?: string; cursor?: string } }>('/api/user/memory', async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });

    const query = (request.query.q || '').trim();
    if (query.length > SEARCH_LIMIT) {
      return reply.code(400).send({ error: 'Search text must be 100 characters or fewer.' });
    }
    const requestedLimit = request.query.limit === undefined ? MEMORY_LIMIT : Number(request.query.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      return reply.code(400).send({ error: 'Page size must be between 1 and 100.' });
    }

    const searchFilters: Prisma.MemoryEntryWhereInput[] = query ? [
      { value: { contains: query, mode: 'insensitive' } },
      { category: { contains: query, mode: 'insensitive' } },
      { key: { contains: query, mode: 'insensitive' } },
    ] : [];

    const where: Prisma.MemoryEntryWhereInput = { userId };
    if (searchFilters.length > 0) where.OR = searchFilters;

    if (request.query.cursor) {
      if (!UUID_PATTERN.test(request.query.cursor)) {
        return reply.code(400).send({ error: 'Invalid memory page cursor.' });
      }
      const cursorWhere: Prisma.MemoryEntryWhereInput = {
        id: request.query.cursor,
        userId,
      };
      if (searchFilters.length > 0) cursorWhere.OR = searchFilters;
      const cursorEntry = await fastify.prisma.memoryEntry.findFirst({
        where: cursorWhere,
        select: { id: true, createdAt: true },
      });
      if (!cursorEntry) return reply.code(400).send({ error: 'Memory page cursor is unavailable for this account.' });
      // Keep null timestamps at the end of the descending order so cursor
      // comparisons remain deterministic for legacy rows with no createdAt.
      const afterCursor: Prisma.MemoryEntryWhereInput =
        cursorEntry.createdAt === null
          ? { createdAt: null, id: { lt: cursorEntry.id } }
          : {
              OR: [
                { createdAt: { lt: cursorEntry.createdAt } },
                { createdAt: cursorEntry.createdAt, id: { lt: cursorEntry.id } },
                { createdAt: null },
              ],
            };
      where.AND = [afterCursor];
    }

    const rows = await fastify.prisma.memoryEntry.findMany({
      where,
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: requestedLimit + 1,
      select: memorySelect,
    });
    const hasMore = rows.length > requestedLimit;
    const entries = hasMore ? rows.slice(0, requestedLimit) : rows;
    return {
      entries,
      limit: requestedLimit,
      hasMore,
      nextCursor: hasMore ? entries[entries.length - 1]?.id ?? null : null,
      query,
    };
  });

  fastify.post<{ Body: { value: string; category?: string } }>('/api/user/memory', {
    schema: {
      body: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: {
          value: { type: 'string', minLength: 1, maxLength: MEMORY_VALUE_LIMIT },
          category: { type: 'string', minLength: 1, maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });

    const value = request.body.value.trim();
    const category = request.body.category?.trim() || 'preference';
    if (!value) return reply.code(400).send({ error: 'Memory content cannot be empty.' });
    if (category.length > 50) return reply.code(400).send({ error: 'Memory category must be 50 characters or fewer.' });

    const entry = await fastify.prisma.memoryEntry.create({
      data: { userId, key: 'vault_' + randomUUID(), value, category },
      select: memorySelect,
    });
    return reply.code(201).send({ entry });
  });

  fastify.put<{ Params: { id: string }; Body: { value: string; category?: string } }>('/api/user/memory/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: { id: { type: 'string', pattern: UUID_PATTERN.source } },
      },
      body: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: {
          value: { type: 'string', minLength: 1, maxLength: MEMORY_VALUE_LIMIT },
          category: { type: 'string', minLength: 1, maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });

    const value = request.body.value.trim();
    const category = request.body.category?.trim() || 'preference';
    if (!value) return reply.code(400).send({ error: 'Memory content cannot be empty.' });
    if (category.length > 50) return reply.code(400).send({ error: 'Memory category must be 50 characters or fewer.' });

    const updated = await fastify.prisma.memoryEntry.updateMany({
      where: { id: request.params.id, userId },
      data: { value, category },
    });
    if (updated.count !== 1) {
      return reply.code(404).send({ error: 'Memory entry was not found for this account.' });
    }

    const entry = await fastify.prisma.memoryEntry.findFirst({
      where: { id: request.params.id, userId },
      select: memorySelect,
    });
    if (!entry) return reply.code(404).send({ error: 'Memory entry was not found for this account.' });
    return { entry };
  });

  fastify.delete<{ Params: { id: string } }>('/api/user/memory/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: { id: { type: 'string', pattern: UUID_PATTERN.source } },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });

    const deleted = await fastify.prisma.memoryEntry.deleteMany({
      where: { id: request.params.id, userId },
    });
    if (deleted.count !== 1) {
      return reply.code(404).send({ error: 'Memory entry was not found for this account.' });
    }
    return { deleted: true, id: request.params.id };
  });
};
