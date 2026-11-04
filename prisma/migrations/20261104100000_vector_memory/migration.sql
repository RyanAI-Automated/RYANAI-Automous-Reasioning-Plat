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
-- The live Supabase bootstrap used quoted "sessionId"; older local
-- bootstrap files used unquoted sessionid. Create the legacy index against
-- whichever column exists; the following ordered migration normalizes its name.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_agent_session ON public.agent_memory (session_id, timestamp)';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionid'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_agent_session ON public.agent_memory (sessionid, timestamp)';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_agent_session ON public.agent_memory ("sessionId", timestamp)';
  ELSE
    RAISE EXCEPTION 'agent_memory is missing a recognized session identifier column';
  END IF;
END;
$migration$;
