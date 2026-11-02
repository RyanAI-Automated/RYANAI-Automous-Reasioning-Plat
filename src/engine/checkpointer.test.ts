import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock('../database/db', () => ({
  db: { agentMemory: { create: database.create, findMany: database.findMany } },
}));

import { RyanAICheckpointer } from './checkpointer';

beforeEach(() => vi.clearAllMocks());

describe('RyanAI durable checkpointer', () => {
  it('confirms successful checkpoint persistence', async () => {
    database.create.mockResolvedValue({ id: 'checkpoint-1' });
    await expect(RyanAICheckpointer.saveCheckpoint('mission-1', 2, { status: 'PAUSED_FOR_APPROVAL' })).resolves.toBe(true);
    expect(database.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sessionId: 'mission-1',
        brainSource: 'checkpoint_step_2',
        content: JSON.stringify({ status: 'PAUSED_FOR_APPROVAL' }),
      }),
    }));
  });

  it('rejects invalid checkpoint identifiers and steps before writing', async () => {
    await expect(RyanAICheckpointer.saveCheckpoint('', 1, {})).resolves.toBe(false);
    await expect(RyanAICheckpointer.saveCheckpoint('mission-1', -1, {})).resolves.toBe(false);
    await expect(RyanAICheckpointer.saveCheckpoint('mission-1', 1.5, {})).resolves.toBe(false);
    await expect(RyanAICheckpointer.saveCheckpoint('mission-1', Number.MAX_SAFE_INTEGER + 1, {})).resolves.toBe(false);
    expect(database.create).not.toHaveBeenCalled();
  });

  it('rejects unserializable or oversized state before writing', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(RyanAICheckpointer.saveCheckpoint('mission-1', 1, circular)).resolves.toBe(false);
    await expect(RyanAICheckpointer.saveCheckpoint('mission-1', 1, 'x'.repeat(1_000_001))).resolves.toBe(false);
    expect(database.create).not.toHaveBeenCalled();
  });

  it('reports persistence failure instead of silently claiming success', async () => {
    database.create.mockRejectedValue(new Error('database unavailable'));
    await expect(RyanAICheckpointer.saveCheckpoint('mission-1', 2, {})).resolves.toBe(false);
  });

  it('restores the newest valid checkpoint and scopes the query to checkpoint rows', async () => {
    database.findMany.mockResolvedValue([{
      brainSource: 'checkpoint_step_2',
      metadata: { step: 2 },
      content: JSON.stringify({ missionId: 'mission-1', status: 'PAUSED_FOR_APPROVAL' }),
    }]);
    await expect(RyanAICheckpointer.getLatestCheckpoint('mission-1')).resolves.toEqual({
      step: 2,
      state: { missionId: 'mission-1', status: 'PAUSED_FOR_APPROVAL' },
    });
    expect(database.findMany).toHaveBeenCalledWith({
      where: {
        sessionId: 'mission-1',
        brainSource: { startsWith: 'checkpoint_step_' },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });

  it('skips corrupt, inconsistent and oversized newest rows to recover an older valid checkpoint', async () => {
    database.findMany.mockResolvedValue([
      { brainSource: 'checkpoint_step_5', metadata: { step: 5 }, content: '{broken json' },
      { brainSource: 'checkpoint_step_4', metadata: { step: 3 }, content: JSON.stringify({ invalid: true }) },
      { brainSource: 'checkpoint_step_3', metadata: { step: 3 }, content: JSON.stringify({ recovered: true }) },
    ]);
    await expect(RyanAICheckpointer.getLatestCheckpoint('mission-1')).resolves.toEqual({
      step: 3,
      state: { recovered: true },
    });
  });

  it('returns null when checkpoint storage is unavailable or no candidate is valid', async () => {
    database.findMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(RyanAICheckpointer.getLatestCheckpoint('mission-1')).resolves.toBeNull();
    database.findMany.mockResolvedValueOnce([
      { brainSource: 'checkpoint_step_1', metadata: { step: 1 }, content: '{broken' },
    ]);
    await expect(RyanAICheckpointer.getLatestCheckpoint('mission-1')).resolves.toBeNull();
  });
});
