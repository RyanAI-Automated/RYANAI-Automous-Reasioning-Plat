// src/engine/checkpointer.ts
import { Buffer } from 'node:buffer';
import { db } from '../database/db';

export interface ThreadCheckpoint {
  threadId: string;
  step: number;
  state: unknown;
}

const MAX_CHECKPOINT_BYTES = 1_000_000;
const MAX_RECOVERY_CANDIDATES = 10;

function isValidStep(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export class RyanAICheckpointer {
  /** Persist a bounded, serializable checkpoint and report confirmed storage. */
  static async saveCheckpoint(threadId: string, step: number, state: unknown): Promise<boolean> {
    if (typeof threadId !== 'string' || !threadId.trim() || !isValidStep(step)) return false;
    try {
      const content = JSON.stringify(state);
      if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_CHECKPOINT_BYTES) {
        console.error('[Checkpointer Error] Checkpoint is not serializable or exceeds the size limit.');
        return false;
      }
      await db.agentMemory.create({
        data: {
          sessionId: threadId,
          brainSource: `checkpoint_step_${step}`,
          content,
          metadata: { step, timestamp: Date.now() },
        },
      });
      console.log(`[Checkpointer] State checkpoint saved for thread ${threadId} at step ${step}.`);
      return true;
    } catch (error) {
      console.error(`[Checkpointer Error] Failed to save checkpoint for thread ${threadId}:`, error);
      return false;
    }
  }

  /**
   * Recover the newest valid checkpoint. A corrupt newest row must not hide an
   * earlier valid state; unrelated agent-memory records are never considered.
   */
  static async getLatestCheckpoint(threadId: string): Promise<{ step: number; state: unknown } | null> {
    if (typeof threadId !== 'string' || !threadId.trim()) return null;
    try {
      const candidates = await db.agentMemory.findMany({
        where: {
          sessionId: threadId,
          brainSource: { startsWith: 'checkpoint_step_' },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_RECOVERY_CANDIDATES,
      });
      for (const candidate of candidates) {
        const match = /^checkpoint_step_(0|[1-9]\d*)$/.exec(candidate.brainSource);
        if (!match || !isValidStep(Number(match[1]))) continue;
        const metadata = candidate.metadata as { step?: unknown } | null;
        const metadataStep = metadata?.step;
        if (metadataStep !== undefined && metadataStep !== Number(match[1])) continue;
        if (typeof candidate.content !== 'string' || Buffer.byteLength(candidate.content, 'utf8') > MAX_CHECKPOINT_BYTES) continue;
        try {
          return { step: Number(match[1]), state: JSON.parse(candidate.content) as unknown };
        } catch {
          // Continue to the next older candidate rather than losing recoverable state.
        }
      }
      return null;
    } catch (error) {
      console.error(`[Checkpointer Error] Failed to retrieve checkpoint for thread ${threadId}:`, error);
      return null;
    }
  }
}
