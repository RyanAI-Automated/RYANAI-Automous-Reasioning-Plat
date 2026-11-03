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

-- Older local init volumes used the quoted camelCase column. After an
-- operator-reviewed Prisma baseline, rename it in place rather than dropping
-- or recreating the existing table and its data.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_memory'
          AND column_name = 'sessionId'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_memory'
          AND column_name = 'session_id'
    ) THEN
        ALTER TABLE public.agent_memory RENAME COLUMN "sessionId" TO session_id;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reasoning_embedding
    ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_agent_session
    ON public.agent_memory (session_id, timestamp);
