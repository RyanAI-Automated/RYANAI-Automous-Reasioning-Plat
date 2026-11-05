import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';

const MEMORY_LIMIT = 100;
const MEMORY_VALUE_LIMIT = 2_000;
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

  fastify.get('/api/user/memory', async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });

    const entries = await fastify.prisma.memoryEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MEMORY_LIMIT,
      select: memorySelect,
    });
    return { entries, limit: MEMORY_LIMIT };
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
      data: {
        userId,
        key: 'vault_' + randomUUID(),
        value,
        category,
      },
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
    if (!entry) {
      return reply.code(404).send({ error: 'Memory entry was not found for this account.' });
    }
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
