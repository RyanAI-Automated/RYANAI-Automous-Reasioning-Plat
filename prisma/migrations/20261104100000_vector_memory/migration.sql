-- Bring the legacy Docker Compose pgvector bootstrap under ordered Prisma migration control.
-- Every object is created idempotently so databases initialized by the former
-- Docker Compose bootstrap can upgrade without duplicate-object errors.
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

-- Existing databases may contain either the unquoted legacy identifier
-- sessionId (stored by PostgreSQL as sessionid) or a quoted "sessionId".
-- The current Supabase schema snapshot uses the quoted form. Create the
-- supporting index against the column that actually exists; the following
-- compatibility migration then renames that column to session_id.
DO $$
DECLARE
  session_column TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionid'
  ) THEN
    session_column := 'sessionid';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionId'
  ) THEN
    session_column := '"sessionId"';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    session_column := 'session_id';
  ELSE
    RAISE EXCEPTION 'agent_memory has no recognized session identifier column';
  END IF;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_agent_session ON public.agent_memory (%s, timestamp)',
    session_column
  );
END
$$;

CREATE INDEX IF NOT EXISTS idx_reasoning_embedding
  ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops);
