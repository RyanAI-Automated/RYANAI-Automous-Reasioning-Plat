-- Fence scanner completions with the exact claim attempt.
-- A worker that resumes after its five-minute lease expired must not overwrite
-- the result of a newer worker that reclaimed the same attachment.
DROP FUNCTION IF EXISTS public.finish_ryanai_attachment_scan(text, text, text, text);

CREATE FUNCTION public.finish_ryanai_attachment_scan(
  p_bucket_id text,
  p_object_name text,
  p_status text,
  p_attempt integer,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_status NOT IN ('clean', 'infected', 'failed') THEN
    RAISE EXCEPTION 'Invalid attachment scan result' USING ERRCODE = '22023';
  END IF;
  IF p_attempt IS NULL OR p_attempt < 1 THEN
    RAISE EXCEPTION 'Invalid attachment scan attempt' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ryanai_attachment_scans
  SET status = p_status,
      last_error = CASE WHEN p_error IS NULL THEN NULL ELSE left(p_error, 500) END,
      updated_at = now(),
      scanned_at = CASE WHEN p_status IN ('clean', 'infected') THEN now() ELSE scanned_at END
  WHERE bucket_id = p_bucket_id
    AND object_name = p_object_name
    AND status = 'scanning'
    AND attempts = p_attempt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attachment scan lease was lost or superseded'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_ryanai_attachment_scan(text, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_ryanai_attachment_scan(text, text, text, integer, text)
  TO service_role;

COMMENT ON FUNCTION public.finish_ryanai_attachment_scan(text, text, text, integer, text) IS
  'Completes a malware scan only for the exact current claim attempt, fencing stale workers after lease recovery.';
