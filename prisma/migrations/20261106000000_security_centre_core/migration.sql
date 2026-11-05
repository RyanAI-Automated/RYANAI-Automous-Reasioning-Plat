-- RyanAI Security Centre: evidence-backed scans and findings.
-- Production targets are deliberately excluded from this first iteration.
-- Existing JarvisAuditEvent and AgentRunEvidence remain the general audit/evidence ledgers.

CREATE TABLE IF NOT EXISTS public.security_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('kali_lab_scan', 'remediation_review')),
  environment TEXT NOT NULL CHECK (environment IN ('isolated_kali_lab', 'staging')),
  target_ref TEXT NOT NULL,
  commit_sha TEXT,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')),
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS security_approvals_status_expiry_idx
  ON public.security_approvals (status, expires_at);
CREATE INDEX IF NOT EXISTS security_approvals_target_commit_idx
  ON public.security_approvals (target_ref, commit_sha);

CREATE TABLE IF NOT EXISTS public.security_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID,
  initiated_by TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('github_actions', 'kali_lab', 'manual_import')),
  environment TEXT NOT NULL
    CHECK (environment IN ('isolated_ci', 'isolated_kali_lab', 'staging')),
  target_ref TEXT,
  branch TEXT,
  commit_sha TEXT,
  workflow_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  toolchain JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_id UUID REFERENCES public.security_approvals(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT security_scans_kali_requires_approval
    CHECK (source <> 'kali_lab' OR approval_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS security_scans_created_idx
  ON public.security_scans (created_at DESC);
CREATE INDEX IF NOT EXISTS security_scans_commit_created_idx
  ON public.security_scans (commit_sha, created_at DESC);
CREATE INDEX IF NOT EXISTS security_scans_environment_status_idx
  ON public.security_scans (environment, status, created_at DESC);
CREATE INDEX IF NOT EXISTS security_scans_owner_created_idx
  ON public.security_scans (owner_user_id, created_at DESC);

-- A Kali run consumes a single-use approval bound to the exact environment,
-- target and commit. There is intentionally no production environment value.
CREATE OR REPLACE FUNCTION public.consume_security_scan_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  approval_record public.security_approvals%ROWTYPE;
BEGIN
  IF NEW.source <> 'kali_lab' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO approval_record
    FROM public.security_approvals
    WHERE id = NEW.approval_id
    FOR UPDATE;

  IF NOT FOUND
    OR approval_record.scope <> 'kali_lab_scan'
    OR approval_record.status <> 'approved'
    OR approval_record.expires_at <= NOW()
    OR approval_record.used_at IS NOT NULL
    OR approval_record.environment <> NEW.environment
    OR approval_record.target_ref IS DISTINCT FROM NEW.target_ref
    OR approval_record.commit_sha IS DISTINCT FROM NEW.commit_sha
  THEN
    RAISE EXCEPTION 'Kali scan requires a valid, unused, scope-bound human approval';
  END IF;

  UPDATE public.security_approvals SET used_at = NOW() WHERE id = approval_record.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS security_scans_consume_approval ON public.security_scans;
CREATE TRIGGER security_scans_consume_approval
  BEFORE INSERT ON public.security_scans
  FOR EACH ROW EXECUTE FUNCTION public.consume_security_scan_approval();

CREATE TABLE IF NOT EXISTS public.security_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.security_scans(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  source_tool TEXT NOT NULL,
  rule_id TEXT,
  severity TEXT NOT NULL
    CHECK (severity IN ('critical', 'high', 'medium', 'low', 'informational')),
  confidence TEXT NOT NULL DEFAULT 'unknown'
    CHECK (confidence IN ('unknown', 'low', 'medium', 'high')),
  title TEXT NOT NULL,
  description TEXT,
  affected_component TEXT,
  file_path TEXT,
  start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
  end_line INTEGER CHECK (end_line IS NULL OR end_line > 0),
  cve TEXT,
  cwe TEXT,
  cvss NUMERIC(4,2) CHECK (cvss IS NULL OR (cvss >= 0 AND cvss <= 10)),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'false_positive', 'remediated', 'accepted_risk')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS security_findings_severity_status_seen_idx
  ON public.security_findings (severity, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS security_findings_fingerprint_seen_idx
  ON public.security_findings (fingerprint, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS security_findings_component_status_idx
  ON public.security_findings (affected_component, status);

CREATE TABLE IF NOT EXISTS public.security_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.security_scans(id) ON DELETE CASCADE,
  finding_id UUID REFERENCES public.security_findings(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  artifact_ref TEXT,
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  media_type TEXT,
  redacted_excerpt TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS security_evidence_scan_captured_idx
  ON public.security_evidence (scan_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS security_evidence_finding_captured_idx
  ON public.security_evidence (finding_id, captured_at DESC);

-- Evidence is immutable; corrections are represented by new evidence rows.
-- Cascaded parent deletion remains possible for authorised data erasure.
CREATE OR REPLACE FUNCTION public.reject_security_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'security_evidence is append-only; insert a correction record';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS security_evidence_immutable ON public.security_evidence;
CREATE TRIGGER security_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.security_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_security_evidence_mutation();

CREATE TABLE IF NOT EXISTS public.security_remediations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES public.security_findings(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'verified')),
  proposed_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  verification_scan_id UUID REFERENCES public.security_scans(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'verified' OR verification_scan_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS security_remediations_finding_status_idx
  ON public.security_remediations (finding_id, status, created_at DESC);

-- Security approvals are scoped to isolated Kali or staging only.
-- No approval record can authorise a production target in this release.

-- These records are server-side security evidence, not browser-facing tables.
-- Match the repository's least-privilege pattern and keep local Postgres portable.
DO $security_table_isolation$
DECLARE
  table_name TEXT;
  browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'security_scans',
    'security_findings',
    'security_evidence',
    'security_remediations',
    'security_approvals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);

    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, browser_role);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END;
$security_table_isolation$;
