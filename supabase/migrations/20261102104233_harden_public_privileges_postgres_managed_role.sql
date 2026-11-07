-- Supabase-managed postgres role hardening.
-- The managed postgres role cannot ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin;
-- use the actual migration owner and harden all existing public objects explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', item.tablename);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', item.tablename);
  END LOOP;

  FOR item IN
    SELECT sequence_name FROM information_schema.sequences
    WHERE sequence_schema='public'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated', item.sequence_name);
    EXECUTE format('GRANT ALL PRIVILEGES ON SEQUENCE public.%I TO service_role', item.sequence_name);
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.conversations, public.messages, public.memory_entries
  TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.rooms') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE public.rooms TO authenticated;
  END IF;
  IF to_regclass('public.room_members') IS NOT NULL THEN
    GRANT SELECT, INSERT ON TABLE public.room_members TO authenticated;
  END IF;
  IF to_regclass('public.room_messages') IS NOT NULL THEN
    GRANT SELECT, INSERT ON TABLE public.room_messages TO authenticated;
  END IF;
  IF to_regclass('public.ryanai_attachment_scans') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.ryanai_attachment_scans TO authenticated;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.is_room_member(uuid)') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.is_room_member(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_room_member(uuid) TO authenticated;
  END IF;
  IF to_regprocedure('public.is_room_member_topic(text)') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.is_room_member_topic(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_room_member_topic(text) TO authenticated;
  END IF;
  IF to_regprocedure('public.is_room_owner(uuid)') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.is_room_owner(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_room_owner(uuid) TO authenticated;
  END IF;
END;
$$;