-- Bridge Supabase Auth identities to the legacy Prisma user relation.
-- Supabase Auth remains the credential authority; never copy auth.users password hashes.
ALTER TABLE public.users
  ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.users FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.users FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON TABLE public.users TO service_role;
  END IF;
END
$roles$;

CREATE OR REPLACE FUNCTION public.sync_ryanai_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.users WHERE id = OLD.id::text;
    RETURN OLD;
  END IF;

  INSERT INTO public.users (
    id, email, password_hash, name, created_at, updated_at
  )
  VALUES (
    NEW.id::text,
    COALESCE(NULLIF(NEW.email, ''), 'auth-user-' || NEW.id::text || '@no-email.invalid'),
    NULL,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.created_at, pg_catalog.now())::timestamp(3),
    COALESCE(NEW.updated_at, NEW.created_at, pg_catalog.now())::timestamp(3)
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, public.users.name),
      updated_at = pg_catalog.now();

  RETURN NEW;
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.sync_ryanai_auth_user() FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.sync_ryanai_auth_user() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.sync_ryanai_auth_user() FROM authenticated;
  END IF;
END
$roles$;

DROP TRIGGER IF EXISTS ryanai_auth_user_sync_insert ON auth.users;
CREATE TRIGGER ryanai_auth_user_sync_insert
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_ryanai_auth_user();

DROP TRIGGER IF EXISTS ryanai_auth_user_sync_update ON auth.users;
CREATE TRIGGER ryanai_auth_user_sync_update
AFTER UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_ryanai_auth_user();

DROP TRIGGER IF EXISTS ryanai_auth_user_sync_delete ON auth.users;
CREATE TRIGGER ryanai_auth_user_sync_delete
AFTER DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_ryanai_auth_user();

-- Backfill identity metadata only. Never copy passwords, tokens, or sessions.
INSERT INTO public.users (
  id, email, password_hash, name, created_at, updated_at
)
SELECT
  au.id::text,
  COALESCE(NULLIF(au.email, ''), 'auth-user-' || au.id::text || '@no-email.invalid'),
  NULL,
  COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name'),
  COALESCE(au.created_at, pg_catalog.now())::timestamp(3),
  COALESCE(au.updated_at, au.created_at, pg_catalog.now())::timestamp(3)
FROM auth.users au
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    updated_at = pg_catalog.now();

COMMENT ON TABLE public.users IS
  'Server-only identity shadow of Supabase Auth users; password_hash is NULL for Supabase-managed identities.';
COMMENT ON FUNCTION public.sync_ryanai_auth_user() IS
  'Synchronizes only user identity metadata to the legacy Prisma relation; credentials remain managed by Supabase Auth.';
