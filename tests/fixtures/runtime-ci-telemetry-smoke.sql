-- Assert that unmeasured runtime state is never fabricated by database defaults.
BEGIN;

INSERT INTO public.agent_sessions (
  id, operator, active_graph, user_id, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000051',
  'RyanAI CI telemetry',
  'ci-smoke',
  NULL,
  now(),
  now()
);

DO $$
BEGIN
  IF (SELECT cuda_active FROM public.agent_sessions
      WHERE id = '00000000-0000-4000-8000-000000000051') IS NOT NULL THEN
    RAISE EXCEPTION 'New agent sessions must not claim CUDA is active without a probe';
  END IF;
END;
$$;

INSERT INTO public.agent_messages (
  id, session_id, role, content, reasoning_steps, timestamp, created_at
) VALUES (
  '00000000-0000-4000-8000-000000000052',
  '00000000-0000-4000-8000-000000000051',
  'USER',
  'CI telemetry smoke test',
  'No reasoning steps were measured.',
  '2026-11-03T00:00:00Z',
  now()
);

DO $$
BEGIN
  IF (SELECT latency_ms FROM public.agent_messages
      WHERE id = '00000000-0000-4000-8000-000000000052') IS NOT NULL THEN
    RAISE EXCEPTION 'Unmeasured agent message latency must remain NULL';
  END IF;
END;
$$;

INSERT INTO public.system_telemetry (id)
VALUES ('00000000-0000-4000-8000-000000000053');

DO $$
BEGIN
  IF (SELECT status FROM public.system_telemetry
      WHERE id = '00000000-0000-4000-8000-000000000053') <> 'unknown' THEN
    RAISE EXCEPTION 'System telemetry must default to unknown, not healthy';
  END IF;
END;
$$;

ROLLBACK;
