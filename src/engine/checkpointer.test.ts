import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock('../database/db', () => ({
  db: { agentMemory: { create: database.create, findFirst: database.findFirst } },
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
      }),
    }));
  });

  it('reports persistence failure instead of silently claiming success', async () => {
    database.create.mockRejectedValue(new Error('database unavailable'));
    await expect(RyanAICheckpointer.saveCheckpoint('mission-1', 2, {})).resolves.toBe(false);
  });

  it('restores the newest checkpoint state', async () => {
    database.findFirst.mockResolvedValue({
      metadata: { step: 2 },
      content: JSON.stringify({ missionId: 'mission-1', status: 'PAUSED_FOR_APPROVAL' }),
    });
    await expect(RyanAICheckpointer.getLatestCheckpoint('mission-1')).resolves.toEqual({
      step: 2,
      state: { missionId: 'mission-1', status: 'PAUSED_FOR_APPROVAL' },
    });
  });

  it('returns null when checkpoint storage is unavailable', async () => {
    database.findFirst.mockRejectedValue(new Error('database unavailable'));
    await expect(RyanAICheckpointer.getLatestCheckpoint('mission-1')).resolves.toBeNull();
  });
});
