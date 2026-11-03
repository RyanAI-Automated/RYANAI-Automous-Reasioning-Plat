-- Runtime telemetry must distinguish unmeasured values from real observations.
-- Nullable values mean "not measured"; no synthetic accelerator state or latency is supplied.
ALTER TABLE public.agent_sessions
  ALTER COLUMN cuda_active DROP DEFAULT,
  ALTER COLUMN cuda_active DROP NOT NULL;

ALTER TABLE public.agent_messages
  ALTER COLUMN latency_ms DROP DEFAULT,
  ALTER COLUMN latency_ms DROP NOT NULL;

ALTER TABLE public.system_telemetry
  ALTER COLUMN status SET DEFAULT 'unknown';

COMMENT ON COLUMN public.agent_sessions.cuda_active IS
  'NULL means CUDA availability has not been measured for this session.';

COMMENT ON COLUMN public.agent_messages.latency_ms IS
  'NULL means message latency was not captured; do not substitute a synthetic duration.';

COMMENT ON COLUMN public.system_telemetry.status IS
  'Defaults to unknown until a live telemetry probe records an observed status.';
