ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS queue_type TEXT NOT NULL DEFAULT 'reasoning';

-- Existing workbench records are not eligible for the three-brain reasoning worker.
UPDATE public.agent_runs
SET queue_type = 'coding'
WHERE approval_status = 'pending'
   OR plan_snapshot IS NOT NULL
   OR proposed_diff_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runs_queue_type_status_created_idx
  ON public.agent_runs (queue_type, status, created_at);

CREATE TABLE IF NOT EXISTS public.coding_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workbench_run_id TEXT NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  approval_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  base_commit_sha TEXT NOT NULL,
  proposed_diff_hash TEXT NOT NULL,
  agent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  worker_id TEXT,
  container_name TEXT,
  locked_at TIMESTAMPTZ(6),
  lease_expires_at TIMESTAMPTZ(6),
  next_attempt_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  cancel_requested_at TIMESTAMPTZ(6),
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS coding_tasks_status_next_attempt_idx
  ON public.coding_tasks (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS coding_tasks_status_lease_expiry_idx
  ON public.coding_tasks (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS coding_tasks_user_created_idx
  ON public.coding_tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coding_tasks_workbench_run_idx
  ON public.coding_tasks (workbench_run_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS coding_tasks_workbench_approval_key
  ON public.coding_tasks (workbench_run_id, approval_id);
