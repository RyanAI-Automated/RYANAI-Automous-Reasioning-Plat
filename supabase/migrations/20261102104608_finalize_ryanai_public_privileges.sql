-- Final Supabase public-schema hardening after RyanAI application and Storage tables.
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
    SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated', item.sequence_name);
    EXECUTE format('GRANT ALL PRIVILEGES ON SEQUENCE public.%I TO service_role', item.sequence_name);
  END LOOP;
END;
$$;

-- Exact Data API operations are granted only where matching owner/member RLS policies exist.
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.conversations, public.messages, public.memory_entries
  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rooms TO authenticated;
GRANT SELECT, INSERT ON TABLE public.room_members, public.room_messages TO authenticated;
GRANT SELECT ON TABLE public.ryanai_attachment_scans TO authenticated;

-- Keep trigger functions and internal maintenance RPCs server-only.
DO $$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.sync_ryanai_auth_user()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.sync_ryanai_auth_user() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.enforce_ryanai_attachment_quotas()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_ryanai_attachment_quotas() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.enforce_ryanai_attachment_message_path()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_ryanai_attachment_message_path() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.enqueue_ryanai_attachment_scan()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.enqueue_ryanai_attachment_scan() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.claim_ryanai_attachment_scan()') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.claim_ryanai_attachment_scan() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.claim_ryanai_attachment_scan() TO service_role;
  END IF;
  IF to_regprocedure('public.finish_ryanai_attachment_scan(text,text,text,text)') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.finish_ryanai_attachment_scan(text,text,text,text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.finish_ryanai_attachment_scan(text,text,text,text) TO service_role;
  END IF;
  IF to_regprocedure('public.claim_ryanai_orphan_attachment_cleanup(timestamptz,integer)') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz,integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz,integer) TO service_role;
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