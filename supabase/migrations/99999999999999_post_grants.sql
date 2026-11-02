-- Fail-closed Data API grants for the public schema.
-- RLS policies are necessary but do not replace SQL privileges.
-- Future public tables created by the migration owner receive no client access
-- until an explicit grant is added.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL PRIVILEGES ON TABLES TO service_role;

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

-- The four user-facing tables are protected by owner-scoped RLS policies.
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.profiles, public.conversations, public.messages, public.memory_entries
    TO authenticated;

-- Scan state is visible only to its owning authenticated user through RLS.
-- Clients must never write scanner state or upload-event accounting records.
DO $$
BEGIN
    IF to_regclass('public.ryanai_attachment_scans') IS NOT NULL THEN
        GRANT SELECT ON TABLE public.ryanai_attachment_scans TO authenticated;
    END IF;
END;
$$;
