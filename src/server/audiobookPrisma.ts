import { PrismaClient } from '../generated/audiobook-prisma/index.js';

export type AudiobookPrismaClient = PrismaClient;

type AudiobookPrismaGlobal = typeof globalThis & {
  __ryanaiAudiobookPrisma?: PrismaClient;
  __ryanaiAudiobookDatabaseUrl?: string;
};

const prismaGlobal = globalThis as AudiobookPrismaGlobal;

/**
 * Create a dedicated client for the Neon audiobook database.
 * This client must never fall back to the platform DATABASE_URL.
 */
export function createAudiobookPrismaClient(connectionString: string): PrismaClient {
  const url = connectionString.trim();
  if (!url) {
    throw new Error('AUDIOBOOK_DATABASE_URL is required.');
  }

  return new PrismaClient({
    datasources: {
      db: { url },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

/**
 * Return the API's optional audiobook client. If AUDIOBOOK_DATABASE_URL is
 * absent, audiobook endpoints fail closed while the rest of RyanAI can start.
 */
export function getAudiobookPrismaClient(): PrismaClient | null {
  const url = process.env.AUDIOBOOK_DATABASE_URL?.trim();
  if (!url) return null;

  if (prismaGlobal.__ryanaiAudiobookPrisma) {
    if (prismaGlobal.__ryanaiAudiobookDatabaseUrl !== url) {
      throw new Error('AUDIOBOOK_DATABASE_URL changed after client initialization; restart the process.');
    }
    return prismaGlobal.__ryanaiAudiobookPrisma;
  }

  const client = createAudiobookPrismaClient(url);
  if (process.env.NODE_ENV !== 'production') {
    prismaGlobal.__ryanaiAudiobookPrisma = client;
    prismaGlobal.__ryanaiAudiobookDatabaseUrl = url;
  }
  return client;
}

declare module 'fastify' {
  interface FastifyInstance {
    audiobookPrisma: PrismaClient | null;
  }
}
