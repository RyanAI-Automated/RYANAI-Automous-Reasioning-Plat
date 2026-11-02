-- Retain quarantine audit records while safely expiring infected object bytes.
ALTER TABLE public.ryanai_attachment_scans
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ryanai_attachment_scans_purged_infected_only'
      AND conrelid = 'public.ryanai_attachment_scans'::regclass
  ) THEN
    ALTER TABLE public.ryanai_attachment_scans
      ADD CONSTRAINT ryanai_attachment_scans_purged_infected_only
      CHECK (purged_at IS NULL OR (status = 'infected' AND scanned_at IS NOT NULL));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ryanai_attachment_scans_quarantine_retention_idx
  ON public.ryanai_attachment_scans (scanned_at)
  WHERE status = 'infected' AND purged_at IS NULL;

-- Only the server worker may mark a quarantined object as purged.
GRANT UPDATE (purged_at) ON TABLE public.ryanai_attachment_scans TO service_role;
REVOKE UPDATE (purged_at) ON TABLE public.ryanai_attachment_scans FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.ryanai_attachment_scans.purged_at IS
  'Timestamp when the infected object bytes were removed through Supabase Storage; the scan row remains as an audit record.';
