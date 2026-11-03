-- Move vector-memory bootstrap into Prisma's ordered migration history.
-- This keeps the Compose database empty until "prisma migrate deploy" begins,
-- avoiding Prisma P3005 on a newly-created local database.
-- IF NOT EXISTS preserves databases where the legacy init script already ran.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.reasoning_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    embedding VECTOR(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.agent_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reasoning_embedding
    ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_agent_session
    ON public.agent_memory (session_id, timestamp);
