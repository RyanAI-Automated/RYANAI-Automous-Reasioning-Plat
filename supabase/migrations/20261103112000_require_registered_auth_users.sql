-- Anonymous Supabase Auth users receive the Postgres authenticated role.
-- These tables are intended for permanent RyanAI accounts only. The restrictive
-- predicates compose with existing ownership/member policies without replacing them.
DO $migration$
DECLARE
  target_table text;
  target_name text;
  target_regclass regclass;
  targets text[] := ARRAY[
    'public.conversations',
    'public.memory_entries',
    'public.messages',
    'public.profiles',
    'public.rooms',
    'public.room_members',
    'public.room_messages',
    'public.ryanai_attachment_scans'
  ];
BEGIN
  FOREACH target_table IN ARRAY targets LOOP
    target_regclass := to_regclass(target_table);
    IF target_regclass IS NULL THEN
      RAISE NOTICE 'Skipping absent optional RyanAI table %', target_table;
      CONTINUE;
    END IF;

    target_name := 'ryanai_registered_user_only';
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', target_name, target_regclass);
    EXECUTE format(
      'CREATE POLICY %I ON %s AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT (auth.jwt() ->> ''is_anonymous'')::boolean) IS FALSE)
       WITH CHECK ((SELECT (auth.jwt() ->> ''is_anonymous'')::boolean) IS FALSE)',
      target_name,
      target_regclass
    );
  END LOOP;
END;
$migration$;

-- Apply the same registered-user requirement to the matching app-scoped
-- Storage and Realtime policies while leaving unrelated anon/public policies
-- and non-RyanAI buckets/channels unchanged.
DO $storage_policy$
DECLARE
  target_regclass regclass := to_regclass('storage.objects');
BEGIN
  IF target_regclass IS NOT NULL THEN
    DROP POLICY IF EXISTS ryanai_registered_user_storage_only ON storage.objects;
    CREATE POLICY ryanai_registered_user_storage_only
      ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
      USING (
        (SELECT (auth.jwt() ->> 'is_anonymous')::boolean) IS FALSE
      )
      WITH CHECK (
        (SELECT (auth.jwt() ->> 'is_anonymous')::boolean) IS FALSE
      );
  END IF;
END;
$storage_policy$;

DO $realtime_policy$
DECLARE
  target_regclass regclass := to_regclass('realtime.messages');
BEGIN
  IF target_regclass IS NOT NULL THEN
    DROP POLICY IF EXISTS ryanai_registered_user_realtime_only ON realtime.messages;
    CREATE POLICY ryanai_registered_user_realtime_only
      ON realtime.messages AS RESTRICTIVE FOR ALL TO authenticated
      USING (
        (SELECT (auth.jwt() ->> 'is_anonymous')::boolean) IS FALSE
      )
      WITH CHECK (
        (SELECT (auth.jwt() ->> 'is_anonymous')::boolean) IS FALSE
      );
  END IF;
END;
$realtime_policy$;
