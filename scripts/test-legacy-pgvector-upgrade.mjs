#!/usr/bin/env node
/**
 * Disposable PostgreSQL fixture for testing upgrades from the legacy pgvector
 * bootstrap. Refuses non-local hosts and any database except the CI fixture DB.
 */
import assert from 'node:assert/strict';
import { Pool } from 'pg';

const mode = process.argv[2];
if (!['prepare', 'verify'].includes(mode)) {
  throw new Error('Usage: node scripts/test-legacy-pgvector-upgrade.mjs prepare|verify');
}
if (process.env.RYANAI_DISPOSABLE_MIGRATION_DB !== 'true' || !process.env.DATABASE_URL) {
  throw new Error('Refusing to run without the disposable migration database guard.');
}

const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname), 'Migration fixture must use loopback PostgreSQL.');
assert.equal(decodeURIComponent(url.pathname.slice(1)), 'ryanai_migration_test', 'Unexpected migration fixture database.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
try {
  if (mode === 'prepare') {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.reasoning_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        embedding VECTOR(1536),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.agent_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "sessionId" VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_reasoning_embedding ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_agent_session ON public.agent_memory ("sessionId", timestamp)');
    await pool.query(
      "INSERT INTO public.reasoning_cache (prompt, response) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM public.reasoning_cache WHERE prompt = $1)",
      ['legacy-upgrade-fixture', 'preserve-reasoning-cache-row'],
    );
    await pool.query(
      "INSERT INTO public.agent_memory ("sessionId", role, content) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM public.agent_memory WHERE "sessionId" = $1)",
      ['legacy-upgrade-fixture', 'assistant', 'preserve-agent-memory-row'],
    );
    console.log('Prepared disposable legacy pgvector schema and preservation fixtures.');
  } else {
    const [extension, cache, memory, indexes] = await Promise.all([
      pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'"),
      pool.query("SELECT response FROM public.reasoning_cache WHERE prompt = $1", ['legacy-upgrade-fixture']),
      pool.query("SELECT content FROM public.agent_memory WHERE session_id = $1", ['legacy-upgrade-fixture']),
      pool.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_reasoning_embedding', 'idx_agent_session')"),
    ]);
    assert.equal(extension.rowCount, 1, 'pgvector extension missing after migration');
    assert.equal(cache.rows[0]?.response, 'preserve-reasoning-cache-row', 'Legacy reasoning_cache data was not preserved');
    assert.equal(memory.rows[0]?.content, 'preserve-agent-memory-row', 'Legacy agent_memory data was not preserved');
    assert.deepEqual(new Set(indexes.rows.map((row) => row.indexname)), new Set(['idx_reasoning_embedding', 'idx_agent_session']));
    console.log('Verified legacy pgvector extension, both tables, both indexes, and preserved fixture rows.');
  }
} finally {
  await pool.end();
}
