-- RyanAI vector-backed reasoning cache and agent memory.
-- Supabase PostgreSQL owns this data; Redis remains a separate Render service.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.reasoning_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  embedding extensions.vector(1536),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reasoning_embedding
  ON public.reasoning_cache
  USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_agent_session
  ON public.agent_memory ("sessionId", "timestamp");

ALTER TABLE public.reasoning_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.reasoning_cache, public.agent_memory
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.reasoning_cache, public.agent_memory
  TO service_role;

COMMENT ON TABLE public.reasoning_cache IS
  'Server-only semantic cache for 1536-dimensional reasoning embeddings.';
COMMENT ON TABLE public.agent_memory IS
  'Server-only memory transcript records; not exposed through the Supabase Data API.';
