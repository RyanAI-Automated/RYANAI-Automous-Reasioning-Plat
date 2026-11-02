-- Harden the Supabase Data API grants for the existing RyanAI schema.
-- RLS policies remain the row-level boundary; SQL privileges must also be
-- least-privilege because operations such as TRUNCATE are not filtered by RLS.
--
-- The project currently has both postgres and supabase_admin default ACLs.
-- Restrict both migration-owner paths so newly-created public objects do not
-- silently regain broad browser-role access after this migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL PRIVILEGES ON TABLES TO service_role;
DO $supabase_admin_defaults$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
        -- PostgreSQL only permits changing another role's default ACLs when
        -- the migration role is a member of that role (or a superuser).
        -- On managed Supabase, migrations commonly run as postgres without
        -- supabase_admin membership. Skip this optional owner-specific ACL
        -- adjustment in that case; the active migration owner's defaults and
        -- all existing public table/function grants are still hardened below.
        IF current_user = 'supabase_admin'
           OR pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated';
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role';
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated';
        ELSE
            RAISE NOTICE 'Skipping supabase_admin default ACL adjustment: current migration role is not a member of supabase_admin';
        END IF;
    END IF;
END;
$supabase_admin_defaults$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Restrict every current public table before granting the exact browser
-- operations below. Keep server-side service_role access intact.
DO $$
DECLARE
    item RECORD;
BEGIN
    FOR item IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
            item.tablename
        );
        EXECUTE format(
            'GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role',
            item.tablename
        );
    END LOOP;
END;
$$;

-- Exact authenticated privileges match the current RLS policy verbs.
GRANT SELECT, INSERT, UPDATE
    ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.conversations, public.messages, public.memory_entries
    TO authenticated;

-- Shared-room APIs only support read, creation, and sending under their
-- existing member/owner policies. They do not need client-side DELETE/TRUNCATE.
DO $$
BEGIN
    IF to_regclass('public.rooms') IS NOT NULL THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.rooms TO authenticated';
    END IF;
    IF to_regclass('public.room_members') IS NOT NULL THEN
        EXECUTE 'GRANT SELECT, INSERT ON TABLE public.room_members TO authenticated';
    END IF;
    IF to_regclass('public.room_messages') IS NOT NULL THEN
        EXECUTE 'GRANT SELECT, INSERT ON TABLE public.room_messages TO authenticated';
    END IF;
    IF to_regclass('public.ryanai_attachment_scans') IS NOT NULL THEN
        EXECUTE 'GRANT SELECT ON TABLE public.ryanai_attachment_scans TO authenticated';
    END IF;
END;
$$;

-- Trigger/event-trigger entry points are not browser RPCs. Room helper
-- functions remain callable only by authenticated users because RLS policies
-- use them to evaluate the caller's membership and ownership.
DO $privilege_hardening$
BEGIN
    IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated';
    END IF;
    IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
    END IF;
    IF to_regprocedure('public.is_room_member(uuid)') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.is_room_member(uuid) FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_room_member(uuid) TO authenticated';
    END IF;
    IF to_regprocedure('public.is_room_member_topic(text)') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.is_room_member_topic(text) FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_room_member_topic(text) TO authenticated';
    END IF;
    IF to_regprocedure('public.is_room_owner(uuid)') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.is_room_owner(uuid) FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_room_owner(uuid) TO authenticated';
    END IF;
END;
$privilege_hardening$;
