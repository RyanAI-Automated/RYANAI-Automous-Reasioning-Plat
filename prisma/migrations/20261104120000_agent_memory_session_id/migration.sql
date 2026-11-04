-- Align the legacy vector-memory session column with the runtime SQL contract.
-- The original bootstrap created unquoted sessionId, which PostgreSQL stores as
-- sessionid. Rename in place so existing memory rows and the index are retained.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE public.agent_memory RENAME COLUMN sessionid TO session_id;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE public.agent_memory RENAME COLUMN "sessionId" TO session_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    RAISE EXCEPTION 'agent_memory has no recognized session identifier column; refusing destructive reconciliation';
  END IF;
END
$$;
