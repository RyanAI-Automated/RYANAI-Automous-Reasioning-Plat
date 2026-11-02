ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS plan_hash TEXT,
  ADD COLUMN IF NOT EXISTS base_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS proposed_diff_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_plan_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS approved_diff_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS steering_notes TEXT,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS agent_runs_approval_status_created_idx
  ON public.agent_runs (approval_status, created_at);

CREATE TABLE IF NOT EXISTS public.agent_run_evidence (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  payload JSONB NOT NULL,
  previous_hash TEXT,
  hash TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_run_evidence_pkey PRIMARY KEY (id),
  CONSTRAINT agent_run_evidence_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_run_evidence_run_sequence_key
  ON public.agent_run_evidence (run_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS agent_run_evidence_hash_key
  ON public.agent_run_evidence (hash);
CREATE INDEX IF NOT EXISTS agent_run_evidence_run_sequence_idx
  ON public.agent_run_evidence (run_id, sequence);

-- Evidence is append-only. Corrections are new events that reference the prior event.
CREATE OR REPLACE FUNCTION public.reject_agent_run_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agent_run_evidence is append-only; append a correction event instead';
END;
$$;

DROP TRIGGER IF EXISTS agent_run_evidence_immutable ON public.agent_run_evidence;
CREATE TRIGGER agent_run_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.agent_run_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_agent_run_evidence_mutation();
