export interface DatabaseSchemaStatus {
  communications: boolean;
  agentCheckpointer: boolean;
}

export interface DatabaseSchemaQueryResult {
  rows: Array<Record<string, unknown>>;
}

export type DatabaseSchemaQuery = (
  sql: string,
) => Promise<DatabaseSchemaQueryResult>;

/**
 * Read-only schema verification for the API startup path.
 * All DDL belongs in versioned Prisma migrations, never in this function.
 */
export async function inspectDatabaseSchema(
  query: DatabaseSchemaQuery,
): Promise<DatabaseSchemaStatus> {
  const tables = await query(`
    SELECT
      to_regclass('public.communication_conversations') IS NOT NULL AS communication_conversations,
      to_regclass('public.communication_messages') IS NOT NULL AS communication_messages,
      to_regclass('public.checkpoints') IS NOT NULL AS checkpoints,
      to_regclass('public.checkpoint_blobs') IS NOT NULL AS checkpoint_blobs,
      to_regclass('public.checkpoint_writes') IS NOT NULL AS checkpoint_writes,
      to_regclass('public.checkpoint_migrations') IS NOT NULL AS checkpoint_migrations,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'checkpoint_writes'
          AND column_name = 'task_path'
      ) AS checkpoint_task_path
  `);

  const row = tables.rows[0];
  if (!row) {
    throw new Error('Database schema inspection returned no result.');
  }

  const communications =
    row.communication_conversations === true &&
    row.communication_messages === true;

  const checkpointTablesPresent =
    row.checkpoints === true &&
    row.checkpoint_blobs === true &&
    row.checkpoint_writes === true &&
    row.checkpoint_migrations === true &&
    row.checkpoint_task_path === true;

  if (!checkpointTablesPresent) {
    return { communications, agentCheckpointer: false };
  }

  const migration = await query(
    'SELECT MAX(v) AS version FROM public.checkpoint_migrations',
  );
  const version = Number(migration.rows[0]?.version ?? -1);

  return {
    communications,
    // @langchain/langgraph-checkpoint-postgres 1.1.2 has six ordered
    // migrations (0..5); v=5 adds checkpoint_writes.task_path.
    agentCheckpointer: Number.isInteger(version) && version >= 5,
  };
}
