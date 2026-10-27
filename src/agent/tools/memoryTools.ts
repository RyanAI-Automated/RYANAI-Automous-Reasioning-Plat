import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { requireUserId } from './toolContext.js';

/**
 * Load the Prisma client on first use. The shared client is created when its
 * module loads, and the engine imports this file, so a static import would
 * create a database client in every test and script that loads the engine.
 */
async function getPrisma() {
  const { prisma } = await import('../../lib/prisma.js');
  return prisma;
}

export const rememberFactTool = tool(
  async ({ key, value, category }, config) => {
    const userId = requireUserId(config);
    const prisma = await getPrisma();
    // One row for each (userId, key). The unique index makes the upsert atomic.
    const entry = await prisma.memoryEntry.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value, category },
      update: { value, category },
    });
    return JSON.stringify({ saved: true, key: entry.key });
  },
  {
    name: 'remember_fact',
    description:
      'Saves a fact or preference about the user for later conversations. Saving an existing key replaces its value.',
    schema: z.object({
      key: z.string().min(1).max(100).describe('Short label, for example "preferred_language"'),
      value: z.string().min(1).max(2000).describe('The fact to remember'),
      category: z.string().min(1).max(50).default('preference').describe('Group name, for example "project" or "preference"'),
    }),
  },
);

export const recallMemoryTool = tool(
  async ({ query }, config) => {
    const userId = requireUserId(config);
    const prisma = await getPrisma();
    const entries = await prisma.memoryEntry.findMany({
      where: {
        userId,
        OR: [
          { key: { contains: query, mode: 'insensitive' } },
          { value: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { key: true, value: true, category: true },
    });
    return JSON.stringify({ query, count: entries.length, entries });
  },
  {
    name: 'recall_memory',
    description: 'Searches the facts and preferences that were saved for the user. Returns up to 10 matches.',
    schema: z.object({
      query: z.string().min(1).max(200).describe('Text to find in saved keys and values'),
    }),
  },
);

export const forgetMemoryTool = tool(
  async ({ key }, config) => {
    const userId = requireUserId(config);
    const prisma = await getPrisma();
    const { count } = await prisma.memoryEntry.deleteMany({ where: { userId, key } });
    return JSON.stringify({ deleted: count });
  },
  {
    name: 'forget_memory',
    description: 'Deletes one saved fact by its exact key.',
    schema: z.object({
      key: z.string().min(1).max(100).describe('Exact key of the fact to delete'),
    }),
  },
);

export const memoryTools = [rememberFactTool, recallMemoryTool, forgetMemoryTool];
