ALTER TABLE "agent_runs"
ADD COLUMN IF NOT EXISTS "trace_context" JSONB;
