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
  agent_run_approval_schema: true,
  agent_run_evidence: true,
  jarvis_audit_events: true,
  reasoning_cache: true,
  agent_memory: true,
  vector_extension: true,
  reasoning_embedding_index: true,
  agent_session_index: true,
};

describe('inspectDatabaseSchema', () => {
  it('reports communication and checkpointer schema only when migrations are present', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [readyTables] })
      .mockResolvedValueOnce({ rows: [{ version: 5 }] });

    await expect(inspectDatabaseSchema(query)).resolves.toEqual({
      communications: true,
      agentCheckpointer: true,
      applicationSchema: true,
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
      applicationSchema: true,
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
      applicationSchema: true,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});


describe('application Prisma schema readiness', () => {
  it('reports the application schema unavailable when required migration objects are missing', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ...readyTables, agent_run_approval_schema: false, agent_run_evidence: false, jarvis_audit_events: false }] })
      .mockResolvedValueOnce({ rows: [{ version: 5 }] });

    await expect(inspectDatabaseSchema(query)).resolves.toMatchObject({
      communications: true,
      agentCheckpointer: true,
      applicationSchema: false,
    });
  });

  it('requires the vector extension, both vector tables, and their indexes', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ...readyTables, vector_extension: false, agent_memory: false, reasoning_embedding_index: false }] })
      .mockResolvedValueOnce({ rows: [{ version: 5 }] });

    await expect(inspectDatabaseSchema(query)).resolves.toMatchObject({
      applicationSchema: false,
    });
  });
});
