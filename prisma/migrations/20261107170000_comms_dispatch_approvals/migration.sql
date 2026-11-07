CREATE TABLE IF NOT EXISTS public.comms_dispatch_approvals (
  id TEXT PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comms_dispatch_approvals_owner_status_expiry_idx
  ON public.comms_dispatch_approvals (owner_user_id, status, expires_at);
