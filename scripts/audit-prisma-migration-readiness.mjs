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

export function assessSchema({ columns, tables, indexes, extensions, agentMemoryColumns = new Set() }) {
  const requiredColumns = [
    'execution_scope', 'approval_status', 'plan_snapshot', 'plan_hash',
    'base_commit_sha', 'proposed_diff_hash', 'approved_plan_hash',
    'approved_commit_sha', 'approved_diff_hash', 'approved_by',
    'approved_at', 'steering_notes', 'cancel_requested_at',
  ];
  const requiredTables = ['agent_run_evidence', 'jarvis_audit_events'];
  const requiredVector = ['reasoning_cache', 'agent_memory'];
  const missingColumns = requiredColumns.filter((name) => !columns.has(name));
  const missingTables = requiredTables.filter((name) => !tables.has(name));
  const missingVectorTables = requiredVector.filter((name) => !tables.has(name));
  return {
    missingColumns,
    missingTables,
    vector: {
      extensionPresent: extensions.has('vector'),
      missingTables: missingVectorTables,
      indexPresent: indexes.has('idx_reasoning_embedding'),
      agentSessionIndexPresent: indexes.has('idx_agent_session'),
      sessionIdColumnPresent: agentMemoryColumns.has('session_id'),
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
    const [columnResult, tableResult, indexResult, extensionResult, agentMemoryColumnResult] = await Promise.all([
      pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_runs'"),
      pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"),
      pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'"),
      pool.query("SELECT extname FROM pg_extension WHERE extname='vector'"),
      pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_memory'"),
    ]);
    const schema = assessSchema({
      columns: new Set(columnResult.rows.map((row) => row.column_name)),
      tables: new Set(tableResult.rows.map((row) => row.table_name)),
      indexes: new Set(indexResult.rows.map((row) => row.indexname)),
      extensions: new Set(extensionResult.rows.map((row) => row.extname)),
      agentMemoryColumns: new Set(agentMemoryColumnResult.rows.map((row) => row.column_name)),
    });
    console.log(JSON.stringify({
      mode: 'read-only',
      migrationState: state,
      schema,
      remediation: 'Review each pending migration against live schema before applying. This command never applies DDL.',
    }, null, 2));
    if (state.pending.length || state.databaseOnly.length ||
        schema.missingColumns.length || schema.missingTables.length ||
        !schema.vector.extensionPresent || schema.vector.missingTables.length || !schema.vector.indexPresent || !schema.vector.agentSessionIndexPresent || !schema.vector.sessionIdColumnPresent) {
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
