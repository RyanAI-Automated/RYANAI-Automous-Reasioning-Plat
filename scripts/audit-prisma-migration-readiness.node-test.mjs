import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareMigrationState, assessSchema } from './audit-prisma-migration-readiness.mjs';

const memoryColumns = new Set(['session_id', 'role', 'content', 'timestamp']);
const cacheColumns = new Set(['id', 'prompt', 'response', 'embedding', 'created_at']);
const cacheColumnTypes = new Map([['embedding', 'vector(1536)']]);
const quantColumns = new Set(['id', 'user_id', 'strategy', 'status', 'input', 'result', 'created_at']);
const vectorIndexes = new Set(['idx_reasoning_embedding', 'idx_agent_session', 'quant_experiments_user_created_idx']);
const vectorIndexDefinitions = new Map([
  ['idx_reasoning_embedding', 'CREATE INDEX idx_reasoning_embedding ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops)'],
  ['idx_agent_session', 'CREATE INDEX idx_agent_session ON public.agent_memory (session_id, timestamp)'],
  ['quant_experiments_user_created_idx', 'CREATE INDEX quant_experiments_user_created_idx ON public.quant_experiments (user_id, created_at DESC)'],
]);

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

test('detects schema and vector-memory drift, including runtime columns and indexes', () => {
  const result = assessSchema({
    columns: new Set(['execution_scope']),
    tables: new Set(['agent_runs', 'reasoning_cache']),
    indexes: new Set(),
    extensions: new Set(),
    memoryColumns: new Set(['sessionid', 'role']),
    cacheColumns: new Set(['id', 'prompt']),
  });
  assert.ok(result.missingColumns.includes('approval_status'));
  assert.ok(result.missingTables.includes('agent_run_evidence'));
  assert.equal(result.vector.extensionPresent, false);
  assert.deepEqual(result.vector.missingTables, ['agent_memory']);
  assert.deepEqual(result.vector.missingMemoryColumns, ['session_id', 'content', 'timestamp']);
  assert.deepEqual(result.vector.missingCacheColumns, ['response', 'embedding', 'created_at']);
  assert.deepEqual(result.vector.missingIndexes, ['idx_reasoning_embedding', 'idx_agent_session', 'quant_experiments_user_created_idx']);
  assert.equal(result.vector.indexPresent, false);
});

test('accepts a complete schema and vector-memory installation', () => {
  const columns = ['execution_scope', 'approval_status', 'plan_snapshot', 'plan_hash', 'base_commit_sha',
    'proposed_diff_hash', 'approved_plan_hash', 'approved_commit_sha', 'approved_diff_hash',
    'approved_by', 'approved_at', 'steering_notes', 'cancel_requested_at'];
  const result = assessSchema({
    columns: new Set(columns),
    tables: new Set(['agent_run_evidence', 'jarvis_audit_events', 'quant_experiments', 'reasoning_cache', 'agent_memory']),
    indexes: vectorIndexes,
    extensions: new Set(['vector']),
    memoryColumns,
    cacheColumns,
    cacheColumnTypes,
    indexDefinitions: vectorIndexDefinitions,
    quantColumns,
  });
  assert.deepEqual(result.missingColumns, []);
  assert.deepEqual(result.missingTables, []);
  assert.deepEqual(result.missingQuantColumns, []);
  assert.equal(result.vector.extensionPresent, true);
  assert.deepEqual(result.vector.missingTables, []);
  assert.deepEqual(result.vector.missingMemoryColumns, []);
  assert.deepEqual(result.vector.missingCacheColumns, []);
  assert.equal(result.vector.embeddingTypeValid, true);
  assert.deepEqual(result.vector.missingIndexes, []);
  assert.deepEqual(result.vector.invalidIndexes, []);
  assert.equal(result.vector.indexPresent, true);
});

test('rejects same-named indexes with incompatible vector or memory definitions', () => {
  const result = assessSchema({
    columns: new Set(),
    tables: new Set(['reasoning_cache', 'agent_memory']),
    indexes: vectorIndexes,
    extensions: new Set(['vector']),
    memoryColumns,
    cacheColumns,
    cacheColumnTypes,
    indexDefinitions: new Map([
      ['idx_reasoning_embedding', 'CREATE INDEX idx_reasoning_embedding ON public.reasoning_cache USING btree (embedding)'],
      ['idx_agent_session', 'CREATE INDEX idx_agent_session ON public.agent_memory (sessionid, timestamp)'],
      ['quant_experiments_user_created_idx', 'CREATE INDEX quant_experiments_user_created_idx ON public.quant_experiments (user_id, created_at DESC)'],
    ]),
  });
  assert.deepEqual(result.vector.invalidIndexes, [
    'idx_reasoning_embedding (requires HNSW vector_cosine_ops)',
    'idx_agent_session (requires session_id, timestamp)',
  ]);
  assert.equal(result.vector.indexPresent, false);
});

test('rejects an embedding column with a different vector dimension', () => {
  const result = assessSchema({
    columns: new Set(),
    tables: new Set(['reasoning_cache', 'agent_memory']),
    indexes: vectorIndexes,
    extensions: new Set(['vector']),
    memoryColumns,
    cacheColumns,
    cacheColumnTypes: new Map([['embedding', 'vector(768)']]),
    indexDefinitions: vectorIndexDefinitions,
  });
  assert.equal(result.vector.embeddingTypeValid, false);
});

test('vector session migration preserves both historical column spellings', () => {
  const migration = readFileSync(
    new URL('../prisma/migrations/20261104120000_agent_memory_session_id/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /RENAME COLUMN "sessionId" TO session_id/);
  assert.match(migration, /RENAME COLUMN sessionid TO session_id/);
});

test('reports missing quant experiment schema columns', () => {
  const result = assessSchema({
    columns: new Set(),
    tables: new Set(['quant_experiments']),
    indexes: new Set(),
    extensions: new Set(),
    memoryColumns: new Set(),
    cacheColumns: new Set(),
    quantColumns: new Set(['id', 'user_id', 'strategy']),
  });
  assert.deepEqual(result.missingQuantColumns, ['status', 'input', 'result', 'created_at']);
});
