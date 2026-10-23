// src/engine/checkpointer.ts
import { db } from '../database/db';

export interface ThreadCheckpoint {
  threadId: string;
  step: number;
  state: unknown;
}

export class RyanAICheckpointer {
  /**
   * Append a checkpoint record for the thread, serializing state as JSON.
   * Serialization and database failures are caught; completion does not confirm a write.
   */
  static async saveCheckpoint(threadId: string, step: number, state: unknown): Promise<void> {
    try {
      await db.agentMemory.create({
        data: {
          sessionId: threadId, // Mapping thread to session ID
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

  /**
   * Return the newest memory record for the thread as parsed state and a step (default 0).
   * Returns null when no record exists or when querying or parsing fails.
   */
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