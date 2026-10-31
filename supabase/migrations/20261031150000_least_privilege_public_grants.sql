-- Correct grants on databases where the former blanket post-grants migration
-- has already been applied. This migration is intentionally fail-closed.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated;',
            r.tablename
        );
        EXECUTE format(
            'GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role;',
            r.tablename
        );
    END LOOP;
END;
$$;

-- Only user-facing tables receive authenticated CRUD, and RLS still limits
-- every operation to the caller's own rows.
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.profiles, public.conversations, public.messages, public.memory_entries
    TO authenticated;

-- Attachment scan records are read-only to authenticated owners under RLS.
-- Upload-event rows and scanner writes remain server-only.
DO $$
BEGIN
    IF to_regclass('public.ryanai_attachment_scans') IS NOT NULL THEN
        GRANT SELECT ON TABLE public.ryanai_attachment_scans TO authenticated;
    END IF;
END;
$$;

COMMENT ON TABLE public.profiles IS
    'User profile data; authenticated access is constrained by owner-scoped RLS.';
