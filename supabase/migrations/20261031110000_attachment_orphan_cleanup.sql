-- Conservative orphan attachment cleanup. An object is eligible only when
-- its message row is gone and it has aged beyond the configured grace period.
ALTER TABLE public.ryanai_attachment_scans
  ADD COLUMN IF NOT EXISTS orphan_purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS orphan_cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orphan_cleanup_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS orphan_cleanup_last_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ryanai_attachment_scans_orphan_cleanup_attempts_nonnegative'
      AND conrelid = 'public.ryanai_attachment_scans'::regclass
  ) THEN
    ALTER TABLE public.ryanai_attachment_scans
      ADD CONSTRAINT ryanai_attachment_scans_orphan_cleanup_attempts_nonnegative
      CHECK (orphan_cleanup_attempts >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ryanai_attachment_scans_orphan_purged_not_infected'
      AND conrelid = 'public.ryanai_attachment_scans'::regclass
  ) THEN
    ALTER TABLE public.ryanai_attachment_scans
      ADD CONSTRAINT ryanai_attachment_scans_orphan_purged_not_infected
      CHECK (orphan_purged_at IS NULL OR status <> 'infected');
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ryanai_attachment_scans_orphan_cleanup_idx
  ON public.ryanai_attachment_scans (created_at, orphan_cleanup_last_attempt_at)
  WHERE orphan_purged_at IS NULL AND status <> 'infected' AND orphan_cleanup_attempts < 5;

CREATE OR REPLACE FUNCTION public.claim_ryanai_orphan_attachment_cleanup(
  p_created_before timestamptz,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(id bigint, bucket_id text, object_name text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_created_before IS NULL OR p_created_before > now() - interval '1 day' THEN
    RAISE EXCEPTION 'Orphan cleanup cutoff must be at least one day old' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT s.id
    FROM public.ryanai_attachment_scans s
    WHERE s.bucket_id = 'ryanai-attachments'
      AND s.status <> 'infected'
      AND s.orphan_purged_at IS NULL
      AND s.created_at < p_created_before
      AND s.orphan_cleanup_attempts < 5
      AND (s.orphan_cleanup_last_attempt_at IS NULL
        OR s.orphan_cleanup_last_attempt_at < now() - interval '6 hours')
      AND split_part(s.object_name, '/', 1) = s.user_id::text
      AND split_part(s.object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND split_part(s.object_name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND NOT EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.id::text = split_part(s.object_name, '/', 3)
          AND m.conversation_id::text = split_part(s.object_name, '/', 2)
      )
    ORDER BY s.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100)
  )
  UPDATE public.ryanai_attachment_scans s
  SET orphan_cleanup_attempts = s.orphan_cleanup_attempts + 1,
      orphan_cleanup_last_attempt_at = now(),
      orphan_cleanup_last_error = NULL
  FROM candidates c
  WHERE s.id = c.id
  RETURNING s.id, s.bucket_id, s.object_name;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz, integer) IS
  'Claims old attachment objects only when their owning message row no longer exists; infected quarantine is excluded.';
