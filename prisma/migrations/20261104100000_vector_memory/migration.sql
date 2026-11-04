-- Bring the legacy Docker Compose pgvector bootstrap under ordered Prisma migration control.
-- Every object is created idempotently so databases initialized by the former
-- docker-entrypoint-initdb.d script can upgrade without duplicate-object errors.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.reasoning_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessionid VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reasoning_embedding
  ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_agent_session
  ON public.agent_memory (sessionid, timestamp);
