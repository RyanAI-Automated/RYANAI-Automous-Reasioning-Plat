-- This is a dedicated Neon audiobook database, not the main RyanAI/Supabase database.
-- The only identity attribute copied from Supabase Auth is the immutable UUID subject.
-- Authentication, authorization claims, emails, passwords, sessions and tokens stay in Supabase.

CREATE TABLE public.supabase_identities (
  id UUID NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supabase_identities_pkey PRIMARY KEY (id)
);

CREATE TABLE public.audiobook_projects (
  id TEXT NOT NULL,
  user_id UUID NOT NULL,
  title VARCHAR(120) NOT NULL,
  language VARCHAR(16) NOT NULL DEFAULT 'en-ZA',
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audiobook_projects_pkey PRIMARY KEY (id),
  CONSTRAINT audiobook_projects_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.supabase_identities(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE public.audiobook_chapters (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title VARCHAR(120) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  narration_settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audiobook_chapters_pkey PRIMARY KEY (id),
  CONSTRAINT audiobook_chapters_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.audiobook_projects(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE public.audiobook_render_jobs (
  id TEXT NOT NULL,
  user_id UUID NOT NULL,
  project_id TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  progress JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  worker_id VARCHAR(120),
  locked_at TIMESTAMPTZ(6),
  lease_expires_at TIMESTAMPTZ(6),
  next_attempt_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancel_requested_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(6),
  idempotency_key VARCHAR(120) NOT NULL,
  request JSONB NOT NULL,
  CONSTRAINT audiobook_render_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT audiobook_render_jobs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.supabase_identities(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT audiobook_render_jobs_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.audiobook_projects(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT audiobook_render_jobs_attempts_check
    CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 5),
  CONSTRAINT audiobook_render_jobs_status_check
    CHECK (status IN ('queued','running','completed','failed','cancel_requested','cancelled'))
);

CREATE INDEX audiobook_projects_user_updated_idx
  ON public.audiobook_projects(user_id, updated_at DESC);
CREATE UNIQUE INDEX audiobook_chapters_project_position_key
  ON public.audiobook_chapters(project_id, position);
CREATE INDEX audiobook_chapters_project_position_idx
  ON public.audiobook_chapters(project_id, position);
CREATE INDEX audiobook_render_jobs_status_next_attempt_idx
  ON public.audiobook_render_jobs(status, next_attempt_at, created_at);
CREATE INDEX audiobook_render_jobs_status_lease_idx
  ON public.audiobook_render_jobs(status, lease_expires_at);
CREATE INDEX audiobook_render_jobs_user_created_idx
  ON public.audiobook_render_jobs(user_id, created_at DESC);
CREATE INDEX audiobook_render_jobs_project_created_idx
  ON public.audiobook_render_jobs(project_id, created_at DESC);
CREATE UNIQUE INDEX audiobook_render_jobs_user_idempotency_key
  ON public.audiobook_render_jobs(user_id, idempotency_key);
CREATE UNIQUE INDEX audiobook_render_jobs_one_active_per_project
  ON public.audiobook_render_jobs(project_id)
  WHERE status IN ('queued','running','cancel_requested');

-- The database is backend-only. Do not allow the default PUBLIC role to create objects
-- in the application schema or access these tables directly.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON TABLE
  public.supabase_identities,
  public.audiobook_projects,
  public.audiobook_chapters,
  public.audiobook_render_jobs
FROM PUBLIC;
