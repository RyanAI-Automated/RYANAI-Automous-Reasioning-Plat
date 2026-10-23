// File path: ./src/engine/checkpointer.ts
import { db } from '../database/db';
import { db } from '../database/db.js';

export interface ThreadCheckpoint {
  threadId: string;
  step: number;
  state: unknown;
}

export class RyanAICheckpointer {
  static async saveCheckpoint(threadId: string, step: number, state: unknown): Promise<void> {
    try {
      await db.agentMemory.create({
        data: {
          sessionId: threadId,
          brainSource: `checkpoint_step_${step}`,
          content: JSON.stringify(state),
          metadata: { step, timestamp: Date.now() }
        }
      });
      console.log(`[Checkpointer] State checkpoint saved for thread ${threadId} at step ${step}.`);
    } catch (error) {
      console.error(`[Checkpointer Error] Failed to save checkpoint for thread ${threadId}:`, error);
    }
  }

  static async getLatestCheckpoint(threadId: string): Promise<{ step: number; state: unknown } | null> {
    try {
      const latestLog = await db.agentMemory.findFirst({
        where: { sessionId: threadId },
        orderBy: { createdAt: 'desc' }
      });

      if (!latestLog) return null;

      return {
        step: (latestLog.metadata as { step?: number } | null)?.step || 0,
        state: JSON.parse(latestLog.content)
      };
    } catch (error) {
      console.error(`[Checkpointer Error] Failed to retrieve checkpoint for thread ${threadId}:`, error);
      return null;
    }
  }
}