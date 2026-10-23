// src/database/memory.ts
import { db } from './db';

interface SaveSessionParams {
  taskPayload: string;
  logicPlan: string;
  primarySynthesis: string;
  finalValidation: string;
}

export class MemoryRepository {
  /**
   * Persists a completed multi-brain reasoning session to PostgreSQL
   */
  static async saveSession(params: SaveSessionParams) {
    try {
      const session = await db.reasoningSession.create({
        data: {
          taskPayload: params.taskPayload,
          logicPlan: params.logicPlan,
          primarySynthesis: params.primarySynthesis,
          finalValidation: params.finalValidation,
          memoryLogs: {
            create: [
              { brainSource: 'logic', content: params.logicPlan },
              { brainSource: 'primary', content: params.primarySynthesis },
              { brainSource: 'secondary', content: params.finalValidation }
            ]
          }
        },
        include: {
          memoryLogs: true
        }
      });
      console.log(`[Database] Session ${session.id} successfully persisted to PostgreSQL.`);
      return session;
    } catch (error) {
      console.error("[Database] Failed to persist session memory:", error);
      throw error;
    }
  }

  /**
   * Retrieves past session history for context injection
   */
  static async getRecentSessions(limit = 10) {
    return await db.reasoningSession.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { memoryLogs: true }
    });
  }
}