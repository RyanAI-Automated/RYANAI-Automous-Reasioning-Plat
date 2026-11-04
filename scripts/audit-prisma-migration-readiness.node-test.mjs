import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareMigrationState, assessSchema } from './audit-prisma-migration-readiness.mjs';

test('reports source migrations absent from the applied ledger without mutating either input', () => {
  const names = ['20261102150000_agent_run_execution_scope', '20261102210000_internal_jarvis_audit'];
  const rows = [{ migration_name: names[0], finished_at: new Date(), rolled_back_at: null }];
  const result = compareMigrationState(names, rows);
  assert.deepEqual(result.pending, [names[1]]);
  assert.deepEqual(result.databaseOnly, []);
  assert.equal(rows.length, 1);
});

test('ignores rolled-back and unfinished ledger entries', () => {
  const result = compareMigrationState(['20261102150000_agent_run_execution_scope'], [
    { migration_name: '20261102150000_agent_run_execution_scope', finished_at: null, rolled_back_at: null },
    { migration_name: '20261102210000_internal_jarvis_audit', finished_at: new Date(), rolled_back_at: new Date() },
  ]);
  assert.deepEqual(result.pending, ['20261102150000_agent_run_execution_scope']);
  assert.deepEqual(result.databaseOnly, []);
});

test('detects schema and vector-memory drift', () => {
  const result = assessSchema({
    columns: new Set(['execution_scope']),
    tables: new Set(['agent_runs', 'reasoning_cache']),
    indexes: new Set(),
    extensions: new Set(),
    agentMemoryColumns: new Set(),
  });
  assert.ok(result.missingColumns.includes('approval_status'));
  assert.ok(result.missingTables.includes('agent_run_evidence'));
  assert.equal(result.vector.extensionPresent, false);
  assert.deepEqual(result.vector.missingTables, ['agent_memory']);
  assert.equal(result.vector.indexPresent, false);
});

test('accepts a complete schema and vector-memory installation', () => {
  const columns = ['execution_scope', 'approval_status', 'plan_snapshot', 'plan_hash', 'base_commit_sha',
    'proposed_diff_hash', 'approved_plan_hash', 'approved_commit_sha', 'approved_diff_hash',
    'approved_by', 'approved_at', 'steering_notes', 'cancel_requested_at'];
  const result = assessSchema({
    columns: new Set(columns),
    tables: new Set(['agent_run_evidence', 'jarvis_audit_events', 'reasoning_cache', 'agent_memory']),
    indexes: new Set(['idx_reasoning_embedding', 'idx_agent_session']),
    extensions: new Set(['vector']),
    agentMemoryColumns: new Set(['session_id']),
    indexDefinitions: new Map([
      ['idx_reasoning_embedding', 'CREATE INDEX idx_reasoning_embedding ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops)'],
      ['idx_agent_session', 'CREATE INDEX idx_agent_session ON public.agent_memory (session_id, timestamp)'],
    ]),
  });
  assert.deepEqual(result.missingColumns, []);
  assert.deepEqual(result.missingTables, []);
  assert.equal(result.vector.extensionPresent, true);
  assert.deepEqual(result.vector.missingTables, []);
  assert.equal(result.vector.indexPresent, true);
  assert.equal(result.vector.reasoningIndexValid, true);
  assert.equal(result.vector.agentSessionIndexPresent, true);
  assert.equal(result.vector.sessionIdColumnPresent, true);
});


test('flags legacy camelCase agent memory columns until normalization is applied', () => {
  const result = assessSchema({
    columns: new Set(),
    tables: new Set(['reasoning_cache', 'agent_memory']),
    indexes: new Set(['idx_reasoning_embedding', 'idx_agent_session']),
    extensions: new Set(['vector']),
    agentMemoryColumns: new Set(['sessionId']),
  });
  assert.equal(result.vector.sessionIdColumnPresent, false);
});

test('vector memory migration normalizes both historical session column spellings', () => {
  const migration = readFileSync(
    new URL('../prisma/migrations/20261104120000_agent_memory_session_id/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /RENAME COLUMN "sessionId" TO session_id/);
  assert.match(migration, /RENAME COLUMN sessionid TO session_id/);
  assert.match(migration, /ON public\.agent_memory \(session_id, timestamp\)/);
});

test('rejects a same-named but non-HNSW vector index', () => {
  const result = assessSchema({
    columns: new Set(),
    tables: new Set(['reasoning_cache', 'agent_memory']),
    indexes: new Set(['idx_reasoning_embedding', 'idx_agent_session']),
    extensions: new Set(['vector']),
    agentMemoryColumns: new Set(['session_id']),
    indexDefinitions: new Map([['idx_reasoning_embedding', 'CREATE INDEX idx_reasoning_embedding ON public.reasoning_cache USING btree (embedding)']]),
  });
  assert.equal(result.vector.indexPresent, true);
  assert.equal(result.vector.reasoningIndexValid, false);
});
