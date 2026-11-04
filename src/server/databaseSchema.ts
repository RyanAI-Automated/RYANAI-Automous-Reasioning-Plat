export interface DatabaseSchemaStatus {
  communications: boolean;
  agentCheckpointer: boolean;
  applicationSchema: boolean;
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
      ) AS checkpoint_task_path,
      (
        SELECT count(*) = 13
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_runs'
          AND column_name IN (
            'execution_scope', 'approval_status', 'plan_snapshot', 'plan_hash',
            'base_commit_sha', 'proposed_diff_hash', 'approved_plan_hash',
            'approved_commit_sha', 'approved_diff_hash', 'approved_by',
            'approved_at', 'steering_notes', 'cancel_requested_at'
          )
      ) AS agent_run_approval_schema,
      to_regclass('public.agent_run_evidence') IS NOT NULL AS agent_run_evidence,
      to_regclass('public.jarvis_audit_events') IS NOT NULL AS jarvis_audit_events,
      to_regclass('public.reasoning_cache') IS NOT NULL AS reasoning_cache,
      to_regclass('public.agent_memory') IS NOT NULL AS agent_memory,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id') AS agent_memory_session_id,
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS vector_extension,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_reasoning_embedding' AND indexdef ILIKE '%USING hnsw%' AND indexdef ILIKE '%vector_cosine_ops%') AS reasoning_embedding_index,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_agent_session') AS agent_session_index
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

  const applicationSchema =
    row.agent_run_approval_schema === true &&
    row.agent_run_evidence === true &&
    row.jarvis_audit_events === true &&
    row.reasoning_cache === true &&
    row.agent_memory === true &&
    row.agent_memory_session_id === true &&
    row.vector_extension === true &&
    row.reasoning_embedding_index === true &&
    row.agent_session_index === true;

  if (!checkpointTablesPresent) {
    return { communications, agentCheckpointer: false, applicationSchema };
  }

  const migration = await query(
    'SELECT MAX(v) AS version FROM public.checkpoint_migrations',
  );
  const version = Number(migration.rows[0]?.version ?? -1);

  return {
    communications,
    applicationSchema,
    // @langchain/langgraph-checkpoint-postgres 1.1.2 has six ordered
    // migrations (0..5); v=5 adds checkpoint_writes.task_path.
    agentCheckpointer: Number.isInteger(version) && version >= 5,
  };
}
