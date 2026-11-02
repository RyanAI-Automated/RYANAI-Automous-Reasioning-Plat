-- Exercise the Supabase Auth -> legacy identity shadow triggers after migrations.
-- The fixture user is disposable and contains no credential material.
BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000042',
  'ryanai-ci-auth-bridge@example.invalid',
  '{"full_name":"RyanAI CI Auth Bridge"}'::jsonb,
  now(),
  now()
);

DO $insert_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = '00000000-0000-4000-8000-000000000042'
      AND email = 'ryanai-ci-auth-bridge@example.invalid'
      AND name = 'RyanAI CI Auth Bridge'
      AND password_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'Supabase Auth INSERT did not create a credential-free identity shadow';
  END IF;
END;
$insert_check$;

UPDATE auth.users
SET email = 'ryanai-ci-auth-bridge-updated@example.invalid'
WHERE id = '00000000-0000-4000-8000-000000000042';

DO $update_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = '00000000-0000-4000-8000-000000000042'
      AND email = 'ryanai-ci-auth-bridge-updated@example.invalid'
      AND password_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'Supabase Auth UPDATE did not synchronize identity metadata';
  END IF;
END;
$update_check$;

DELETE FROM auth.users
WHERE id = '00000000-0000-4000-8000-000000000042';

DO $delete_check$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = '00000000-0000-4000-8000-000000000042'
  ) THEN
    RAISE EXCEPTION 'Supabase Auth DELETE did not remove the identity shadow';
  END IF;
END;
$delete_check$;

COMMIT;
