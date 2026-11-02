-- Persist the server-derived execution scope with the durable task.
-- The empty default intentionally causes legacy/unclassified tasks to run full reconciliation.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS execution_scope JSONB NOT NULL DEFAULT '{}'::jsonb;
