-- Keep RLS helper functions in a non-exposed schema. Their SECURITY DEFINER
-- implementation is still required to avoid recursive RLS evaluation on room
-- membership tables, but the helpers must not be callable through public RPC.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
COMMENT ON SCHEMA private IS
  'Internal database helpers only. Do not expose this schema through the Supabase Data API.';

DO $room_helper_migration$
BEGIN
  -- The shared-room tables are managed outside the checked-in migrations in
  -- some deployments. Skip function relocation when that feature is absent.
  IF to_regclass('public.rooms') IS NULL
     OR to_regclass('public.room_members') IS NULL THEN
    RAISE NOTICE 'Shared-room tables are absent; skipping room RLS helper relocation.';
    RETURN;
  END IF;

  EXECUTE $function_ddl$
    CREATE OR REPLACE FUNCTION private.is_room_member(_room_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT EXISTS (
        SELECT 1
        FROM public.room_members AS rm
        WHERE rm.room_id = _room_id
          AND rm.user_id = (SELECT auth.uid())
      );
    $body$;
  $function_ddl$;

  EXECUTE $function_ddl$
    CREATE OR REPLACE FUNCTION private.is_room_owner(_room_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT EXISTS (
        SELECT 1
        FROM public.rooms AS r
        WHERE r.id = _room_id
          AND r.created_by = (SELECT auth.uid())
      );
    $body$;

  EXECUTE $function_ddl$
    CREATE OR REPLACE FUNCTION private.is_room_member_topic(_topic text)
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      _room_id uuid;
    BEGIN
      IF _topic !~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:messages$' THEN
        RETURN false;
      END IF;

      _room_id := split_part(_topic, ':', 2)::uuid;
      RETURN private.is_room_member(_room_id);
    END;
    $body$;
  $function_ddl$;

  REVOKE ALL ON FUNCTION private.is_room_member(uuid) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION private.is_room_owner(uuid) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION private.is_room_member_topic(text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION private.is_room_member(uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION private.is_room_owner(uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION private.is_room_member_topic(text) TO authenticated;

  -- Update every current policy dependency before removing the exposed public
  -- wrappers. Policy owner/member checks are otherwise unchanged.
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.room_members'::regclass AND polname = 'room_members_member_read') THEN
    EXECUTE 'ALTER POLICY room_members_member_read ON public.room_members USING ((SELECT private.is_room_member(room_members.room_id)))';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.room_members'::regclass AND polname = 'room_members_owner_add') THEN
    EXECUTE 'ALTER POLICY room_members_owner_add ON public.room_members WITH CHECK ((SELECT private.is_room_owner(room_members.room_id)))';
  END IF;
  IF to_regclass('public.room_messages') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.room_messages'::regclass AND polname = 'room_messages_member_read') THEN
      EXECUTE 'ALTER POLICY room_messages_member_read ON public.room_messages USING ((SELECT private.is_room_member(room_messages.room_id)))';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.room_messages'::regclass AND polname = 'room_messages_member_send') THEN
      EXECUTE 'ALTER POLICY room_messages_member_send ON public.room_messages WITH CHECK ((sender_id = (SELECT auth.uid())) AND (SELECT private.is_room_member(room_messages.room_id)))';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.rooms'::regclass AND polname = 'rooms_creator_update_name') THEN
    EXECUTE 'ALTER POLICY rooms_creator_update_name ON public.rooms USING ((SELECT private.is_room_owner(rooms.id))) WITH CHECK ((SELECT private.is_room_owner(rooms.id)))';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.rooms'::regclass AND polname = 'rooms_member_read') THEN
    EXECUTE 'ALTER POLICY rooms_member_read ON public.rooms USING ((SELECT private.is_room_member(rooms.id)))';
  END IF;
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'realtime.messages'::regclass AND polname = 'room_chat_member_presence') THEN
      EXECUTE 'ALTER POLICY room_chat_member_presence ON realtime.messages WITH CHECK ((SELECT private.is_room_member_topic((SELECT realtime.topic()))) AND (extension = ''presence''::text))';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'realtime.messages'::regclass AND polname = 'room_chat_member_receive') THEN
      EXECUTE 'ALTER POLICY room_chat_member_receive ON realtime.messages USING ((SELECT private.is_room_member_topic((SELECT realtime.topic()))) AND (extension = ANY (ARRAY[''broadcast''::text, ''presence''::text])))';
    END IF;
  END IF;

  -- No CASCADE: an unexpected dependency should stop the migration for review.
  IF to_regprocedure('public.is_room_member_topic(text)') IS NOT NULL THEN
    DROP FUNCTION public.is_room_member_topic(text);
  END IF;
  IF to_regprocedure('public.is_room_member(uuid)') IS NOT NULL THEN
    DROP FUNCTION public.is_room_member(uuid);
  END IF;
  IF to_regprocedure('public.is_room_owner(uuid)') IS NOT NULL THEN
    DROP FUNCTION public.is_room_owner(uuid);
  END IF;
END;
$room_helper_migration$;
