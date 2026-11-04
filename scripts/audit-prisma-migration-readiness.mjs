#!/usr/bin/env node
/**
 * Read-only Prisma migration readiness audit.
 * Never applies migrations, alters schema, prints DATABASE_URL, or reads row data.
 */
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function compareMigrationState(localNames, appliedRows) {
  const applied = new Set(appliedRows
    .filter((row) => row.finished_at && !row.rolled_back_at)
    .map((row) => row.migration_name));
  const local = [...localNames].filter((name) => /^\d{14}_[a-z0-9_]+$/.test(name)).sort();
  return {
    local,
    applied: [...applied].sort(),
    pending: local.filter((name) => !applied.has(name)),
    databaseOnly: [...applied].filter((name) => !local.includes(name)).sort(),
  };
}

export function assessSchema({ columns, tables, indexes, extensions, memoryColumns, cacheColumns, cacheColumnTypes = new Map(), indexDefinitions = new Map(), quantColumns = new Set(), constraints = new Set() }) {
  const requiredColumns = [
    'execution_scope', 'approval_status', 'plan_snapshot', 'plan_hash',
    'base_commit_sha', 'proposed_diff_hash', 'approved_plan_hash',
    'approved_commit_sha', 'approved_diff_hash', 'approved_by',
    'approved_at', 'steering_notes', 'cancel_requested_at',
  ];
  const requiredTables = ['agent_run_evidence', 'jarvis_audit_events', 'quant_experiments'];
  const requiredVector = ['reasoning_cache', 'agent_memory'];
  const missingColumns = requiredColumns.filter((name) => !columns.has(name));
  const missingTables = requiredTables.filter((name) => !tables.has(name));
  const requiredQuantColumns = ['id', 'user_id', 'strategy', 'status', 'input', 'result', 'created_at'];
  const missingQuantColumns = requiredQuantColumns.filter((name) => !quantColumns.has(name));
  const missingVectorTables = requiredVector.filter((name) => !tables.has(name));
  const requiredMemoryColumns = ['id', 'session_id', 'role', 'content', 'timestamp'];
  const requiredCacheColumns = ['id', 'prompt', 'response', 'embedding', 'created_at'];
  const missingMemoryColumns = requiredMemoryColumns.filter((name) => !memoryColumns.has(name));
  const missingCacheColumns = requiredCacheColumns.filter((name) => !cacheColumns.has(name));
  const requiredIndexes = ['idx_reasoning_embedding', 'idx_agent_session', 'quant_experiments_user_created_idx'];
  const missingIndexes = requiredIndexes.filter((name) => !indexes.has(name));
  const reasoningIndexDefinition = (indexDefinitions.get('idx_reasoning_embedding') ?? '').toLowerCase();
  const agentSessionIndexDefinition = (indexDefinitions.get('idx_agent_session') ?? '').toLowerCase();
  const quantIndexDefinition = (indexDefinitions.get('quant_experiments_user_created_idx') ?? '').toLowerCase();
  const invalidIndexes = [
    ...(indexes.has('idx_reasoning_embedding') &&
      (!reasoningIndexDefinition.includes('using hnsw') || !reasoningIndexDefinition.includes('vector_cosine_ops'))
      ? ['idx_reasoning_embedding (requires HNSW vector_cosine_ops)'] : []),
    ...(indexes.has('idx_agent_session') &&
      (!agentSessionIndexDefinition.includes('session_id') || !agentSessionIndexDefinition.includes('timestamp'))
      ? ['idx_agent_session (requires session_id, timestamp)'] : []),
    ...(indexes.has('quant_experiments_user_created_idx') &&
      (!quantIndexDefinition.includes('user_id') || !quantIndexDefinition.includes('created_at'))
      ? ['quant_experiments_user_created_idx (requires user_id, created_at)'] : []),
  ];
  return {
    missingColumns,
    missingTables,
    missingQuantColumns,
    quantUserForeignKeyPresent: constraints.has('quant_experiments_user_id_fkey'),
    vector: {
      extensionPresent: extensions.has('vector'),
      missingTables: missingVectorTables,
      missingMemoryColumns,
      missingCacheColumns,
      embeddingTypeValid: cacheColumnTypes.get('embedding') === 'vector(1536)',
      missingIndexes,
      invalidIndexes,
      indexPresent: missingIndexes.length === 0 && invalidIndexes.length === 0,
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('BLOCKED: DATABASE_URL is required (value is never printed).');
    process.exitCode = 2;
    return;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const migrationRoot = resolve(root, 'prisma/migrations');
  const entries = await readdir(migrationRoot, { withFileTypes: true });
  const localNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const migrationResult = await pool.query(
      'SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
    );
    const state = compareMigrationState(localNames, migrationResult.rows);
    const [columnResult, tableResult, indexResult, extensionResult, memoryColumnResult, cacheColumnResult, quantColumnResult, constraintResult] = await Promise.all([
      pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_runs'"),
      pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"),
      pool.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'"),
      pool.query("SELECT extname FROM pg_extension WHERE extname='vector'"),
      pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_memory'"),
      pool.query("SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS formatted_type FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'reasoning_cache' AND a.attnum > 0 AND NOT a.attisdropped"),
      pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='quant_experiments'"),
      pool.query("SELECT conname FROM pg_constraint WHERE conrelid = to_regclass('public.quant_experiments') AND contype = 'f'"),
    ]);
    const schema = assessSchema({
      columns: new Set(columnResult.rows.map((row) => row.column_name)),
      tables: new Set(tableResult.rows.map((row) => row.table_name)),
      indexes: new Set(indexResult.rows.map((row) => row.indexname)),
      indexDefinitions: new Map(indexResult.rows.map((row) => [row.indexname, row.indexdef])),
      extensions: new Set(extensionResult.rows.map((row) => row.extname)),
      memoryColumns: new Set(memoryColumnResult.rows.map((row) => row.column_name)),
      cacheColumns: new Set(cacheColumnResult.rows.map((row) => row.column_name)),
      cacheColumnTypes: new Map(cacheColumnResult.rows.map((row) => [row.column_name, row.formatted_type])),
      quantColumns: new Set(quantColumnResult.rows.map((row) => row.column_name)),
      constraints: new Set(constraintResult.rows.map((row) => row.conname)),
    });
    console.log(JSON.stringify({
      mode: 'read-only',
      migrationState: state,
      schema,
      remediation: 'Review each pending migration against live schema before applying. This command never applies DDL.',
    }, null, 2));
    if (state.pending.length || state.databaseOnly.length ||
        schema.missingColumns.length || schema.missingTables.length || schema.missingQuantColumns.length || !schema.quantUserForeignKeyPresent ||
        !schema.vector.extensionPresent || schema.vector.missingTables.length ||
        schema.vector.missingMemoryColumns.length || schema.vector.missingCacheColumns.length || !schema.vector.embeddingTypeValid ||
        schema.vector.missingIndexes.length || schema.vector.invalidIndexes.length) {
      process.exitCode = 1;
    }
  } catch {
    console.error('BLOCKED: migration metadata/schema audit failed. Check database connectivity and permissions; connection details were suppressed.');
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('BLOCKED: migration audit could not complete; error details suppressed.');
    process.exitCode = 2;
  });
}
