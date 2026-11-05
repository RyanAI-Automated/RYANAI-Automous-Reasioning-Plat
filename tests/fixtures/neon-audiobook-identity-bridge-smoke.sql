-- Disposable CI fixture for the dedicated Neon audiobook schema.
-- Uses synthetic identifiers and data only; the transaction is rolled back.
BEGIN;

INSERT INTO public.supabase_identities (id)
VALUES ('00000000-0000-4000-8000-000000000042')
ON CONFLICT (id) DO NOTHING;

-- A repeated verified login must not duplicate or mutate the subject anchor.
INSERT INTO public.supabase_identities (id)
VALUES ('00000000-0000-4000-8000-000000000042')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.audiobook_projects (id, user_id, title, language)
VALUES ('project-bridge-test', '00000000-0000-4000-8000-000000000042', 'Synthetic identity bridge test', 'en-ZA');

INSERT INTO public.audiobook_chapters (id, project_id, title, content, position, narration_settings)
VALUES ('chapter-bridge-test', 'project-bridge-test', 'Chapter 1', 'Synthetic test text only.', 0, '{"voice":"coral","speed":1}'::jsonb);

INSERT INTO public.audiobook_render_jobs (id, user_id, project_id, idempotency_key, request)
VALUES (
  'job-bridge-test',
  '00000000-0000-4000-8000-000000000042',
  'project-bridge-test',
  'bridge-smoke-idempotency-key',
  '{"projectId":"project-bridge-test","chapters":[]}'::jsonb
);

DO $test$
DECLARE
  identity_count INTEGER;
  project_count INTEGER;
  chapter_count INTEGER;
  job_count INTEGER;
  identity_column_count INTEGER;
BEGIN
  SELECT count(*) INTO identity_count
  FROM public.supabase_identities
  WHERE id = '00000000-0000-4000-8000-000000000042';

  SELECT count(*) INTO project_count
  FROM public.audiobook_projects
  WHERE id = 'project-bridge-test'
    AND user_id = '00000000-0000-4000-8000-000000000042';

  SELECT count(*) INTO chapter_count
  FROM public.audiobook_chapters
  WHERE id = 'chapter-bridge-test' AND project_id = 'project-bridge-test';

  SELECT count(*) INTO job_count
  FROM public.audiobook_render_jobs
  WHERE id = 'job-bridge-test'
    AND user_id = '00000000-0000-4000-8000-000000000042';

  SELECT count(*) INTO identity_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'supabase_identities'
    AND column_name IN (
      'email', 'name', 'password_hash', 'role', 'app_metadata',
      'user_metadata', 'access_token', 'refresh_token', 'session_id'
    );

  IF identity_count <> 1 OR project_count <> 1 OR chapter_count <> 1 OR job_count <> 1 THEN
    RAISE EXCEPTION 'Supabase identity to audiobook ownership smoke test failed';
  END IF;

  IF identity_column_count <> 0 THEN
    RAISE EXCEPTION 'Neon identity anchor contains profile or authentication data';
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    RAISE EXCEPTION 'Neon audiobook database must not shadow Supabase auth.users';
  END IF;

  BEGIN
    INSERT INTO public.audiobook_projects (id, user_id, title)
    VALUES ('orphan-project-test', '00000000-0000-4000-8000-000000000099', 'Must be rejected');
    RAISE EXCEPTION 'Foreign key accepted a project without an identity anchor';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.audiobook_render_jobs (id, user_id, project_id, idempotency_key, request)
    VALUES (
      'duplicate-idempotency-test',
      '00000000-0000-4000-8000-000000000042',
      'project-bridge-test',
      'bridge-smoke-idempotency-key',
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Unique idempotency index accepted a duplicate key';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.audiobook_render_jobs (id, user_id, project_id, idempotency_key, request)
    VALUES (
      'duplicate-active-render-test',
      '00000000-0000-4000-8000-000000000042',
      'project-bridge-test',
      'second-render-idempotency-key',
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Active render guard accepted a second active job';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$test$;

ROLLBACK;
