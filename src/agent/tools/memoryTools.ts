import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { requireUserId } from './toolContext.js';

async function getMemoryService() {
  const [{ prisma }, service] = await Promise.all([
    import('../../lib/prisma.js'),
    import('../../server/memory/memoryService.js'),
  ]);
  return { memory: prisma.memoryEntry, service };
}

export const rememberFactTool = tool(
  async ({ key, value, category }, config) => {
    const userId = requireUserId(config);
    const { memory, service } = await getMemoryService();
    return JSON.stringify(await service.rememberUserFact(memory, userId, key, value, category));
  },
  {
    name: 'remember_fact',
    description: 'Saves a fact or preference through the API-owned, account-scoped memory service. Saving an existing key replaces its value.',
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
    const { memory, service } = await getMemoryService();
    return JSON.stringify(await service.recallUserFacts(memory, userId, query));
  },
  {
    name: 'recall_memory',
    description: 'Searches the facts and preferences that were saved for the authenticated user through the API-owned memory service.',
    schema: z.object({
      query: z.string().min(1).max(200).describe('Text to find in saved keys and values'),
    }),
  },
);

export const forgetMemoryTool = tool(
  async ({ key }, config) => {
    const userId = requireUserId(config);
    const { memory, service } = await getMemoryService();
    return JSON.stringify(await service.forgetUserFact(memory, userId, key));
  },
  {
    name: 'forget_memory',
    description: 'Deletes one saved fact by its exact key through the API-owned, account-scoped memory service.',
    schema: z.object({
      key: z.string().min(1).max(100).describe('Exact key of the fact to delete'),
    }),
  },
);

export const memoryTools = [rememberFactTool, recallMemoryTool, forgetMemoryTool];
