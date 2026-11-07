import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';
import { createUserMemory, deleteUserMemory, listUserMemory, updateUserMemory } from '../memory/memoryService.js';

export const memoryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireUser);

  fastify.get<{ Querystring: { q?: string; limit?: string; cursor?: string } }>('/api/user/memory', async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const query = (request.query.q || '').trim();
    if (query.length > 100) return reply.code(400).send({ error: 'Search text must be 100 characters or fewer.' });
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.code(400).send({ error: 'Page size must be between 1 and 100.' });
    }
    try {
      return await listUserMemory(fastify.prisma.memoryEntry, userId, {
        query, limit, cursor: request.query.cursor,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/cursor|search text|page size/i.test(message)) return reply.code(400).send({ error: message });
      throw error;
    }
  });

  fastify.post<{ Body: { value: string; category?: string } }>('/api/user/memory', {
    schema: {
      body: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: {
          value: { type: 'string', minLength: 1, maxLength: 2_000 },
          category: { type: 'string', minLength: 1, maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    try {
      const entry = await createUserMemory(fastify.prisma.memoryEntry, userId, request.body.value, request.body.category);
      return reply.code(201).send({ entry });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/memory content|memory category/i.test(message)) return reply.code(400).send({ error: message });
      throw error;
    }
  });

  fastify.put<{ Params: { id: string }; Body: { value: string; category?: string } }>('/api/user/memory/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' } },
      },
      body: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: {
          value: { type: 'string', minLength: 1, maxLength: 2_000 },
          category: { type: 'string', minLength: 1, maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    try {
      const entry = await updateUserMemory(fastify.prisma.memoryEntry, userId, request.params.id, request.body.value, request.body.category);
      if (!entry) return reply.code(404).send({ error: 'Memory entry was not found for this account.' });
      return { entry };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/memory entry ID|memory content|memory category/i.test(message)) return reply.code(400).send({ error: message });
      throw error;
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/user/memory/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: { id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } },
      },
    },
  }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    try {
      const deleted = await deleteUserMemory(fastify.prisma.memoryEntry, userId, request.params.id);
      if (!deleted) return reply.code(404).send({ error: 'Memory entry was not found for this account.' });
      return { deleted: true, id: request.params.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/memory entry ID/i.test(message)) return reply.code(400).send({ error: message });
      throw error;
    }
  });
};
