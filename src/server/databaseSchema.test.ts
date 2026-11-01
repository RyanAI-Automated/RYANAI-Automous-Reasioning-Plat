import { describe, expect, it, vi } from 'vitest';
import { inspectDatabaseSchema } from './databaseSchema.js';

const readyTables = {
  communication_conversations: true,
  communication_messages: true,
  checkpoints: true,
  checkpoint_blobs: true,
  checkpoint_writes: true,
  checkpoint_migrations: true,
  checkpoint_task_path: true,
};

describe('inspectDatabaseSchema', () => {
  it('reports communication and checkpointer schema only when migrations are present', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [readyTables] })
      .mockResolvedValueOnce({ rows: [{ version: 5 }] });

    await expect(inspectDatabaseSchema(query)).resolves.toEqual({
      communications: true,
      agentCheckpointer: true,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).not.toMatch(/CREATE|ALTER|DROP/i);
  });

  it('keeps the checkpointer degraded when its tables or task_path are missing', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ ...readyTables, checkpoint_task_path: false }],
    });

    await expect(inspectDatabaseSchema(query)).resolves.toEqual({
      communications: true,
      agentCheckpointer: false,
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it('keeps the checkpointer degraded when the package migration version is behind', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [readyTables] })
      .mockResolvedValueOnce({ rows: [{ version: 4 }] });

    await expect(inspectDatabaseSchema(query)).resolves.toEqual({
      communications: true,
      agentCheckpointer: false,
    });
  });

  it('reports missing communication schema without pretending the database is ready', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ ...readyTables, communication_messages: false }],
      })
      .mockResolvedValueOnce({ rows: [{ version: 5 }] });

    await expect(inspectDatabaseSchema(query)).resolves.toEqual({
      communications: false,
      agentCheckpointer: true,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
