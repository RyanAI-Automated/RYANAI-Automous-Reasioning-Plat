-- Simulate the legacy Docker Compose bootstrap on a database that already
-- has the first eight ordered Prisma migrations applied.
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
  "sessionId" VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reasoning_embedding
  ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_agent_session
  ON public.agent_memory ("sessionId", timestamp);

-- A pre-existing row must survive the session column compatibility migration.
INSERT INTO public.agent_memory ("sessionId", role, content)
VALUES ('legacy-session', 'assistant', 'preserve me');
