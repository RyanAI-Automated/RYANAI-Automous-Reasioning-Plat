-- Verify anonymous Auth identities cannot use RyanAI-owned public data,
-- while permanent users retain their existing owner-scoped access policies.
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous
) VALUES
  (
    '00000000-0000-4000-8000-000000000061',
    'authenticated', 'authenticated', 'ryanai-ci-registered@example.invalid',
    '{}'::jsonb, '{}'::jsonb, false
  ),
  (
    '00000000-0000-4000-8000-000000000062',
    'authenticated', 'authenticated', NULL,
    '{}'::jsonb, '{}'::jsonb, true
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conversations (id, user_id, title)
VALUES
  (
    '00000000-0000-4000-8000-000000000063',
    '00000000-0000-4000-8000-000000000061',
    'Registered-user CI row'
  ),
  (
    '00000000-0000-4000-8000-000000000064',
    '00000000-0000-4000-8000-000000000062',
    'Anonymous-user CI row'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.messages (id, conversation_id, role, content)
VALUES (
  '00000000-0000-4000-8000-000000000065',
  '00000000-0000-4000-8000-000000000063',
  'user',
  'RLS smoke fixture'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.memory_entries (id, user_id, key, value)
VALUES (
  '00000000-0000-4000-8000-000000000066',
  '00000000-0000-4000-8000-000000000061',
  'ci-rls-smoke',
  'registered-user-value'
)
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000062","role":"authenticated","is_anonymous":true}',
  true
);

DO $anonymous_check$
BEGIN
  IF (SELECT count(*) FROM public.conversations) <> 0 THEN
    RAISE EXCEPTION 'Anonymous Auth identity read RyanAI conversations';
  END IF;
  IF (SELECT count(*) FROM public.messages) <> 0 THEN
    RAISE EXCEPTION 'Anonymous Auth identity read RyanAI messages';
  END IF;
  IF (SELECT count(*) FROM public.memory_entries) <> 0 THEN
    RAISE EXCEPTION 'Anonymous Auth identity read RyanAI memory';
  END IF;
  IF (SELECT count(*) FROM public.profiles) <> 0 THEN
    RAISE EXCEPTION 'Anonymous Auth identity read RyanAI profiles';
  END IF;

  BEGIN
    INSERT INTO public.conversations (user_id, title)
    VALUES ('00000000-0000-4000-8000-000000000062', 'Must be rejected');
    RAISE EXCEPTION 'Anonymous Auth identity inserted a RyanAI conversation';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$anonymous_check$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}',
  true
);

DO $registered_check$
BEGIN
  IF (SELECT count(*) FROM public.conversations) <> 1 THEN
    RAISE EXCEPTION 'Registered Auth identity did not retain owner-scoped conversation access';
  END IF;
  IF (SELECT count(*) FROM public.messages) <> 1 THEN
    RAISE EXCEPTION 'Registered Auth identity did not retain owned message access';
  END IF;
  IF (SELECT count(*) FROM public.memory_entries) <> 1 THEN
    RAISE EXCEPTION 'Registered Auth identity did not retain owner-scoped memory access';
  END IF;
  IF (SELECT count(*) FROM public.profiles) <> 1 THEN
    RAISE EXCEPTION 'Registered Auth identity did not retain own profile access';
  END IF;
END;
$registered_check$;

RESET ROLE;
ROLLBACK;
