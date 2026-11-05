begin;

-- Run with: supabase test db
-- Fixtures and assertions are transaction-scoped; no hosted data is changed.
select plan(10);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'memory-rls-a@example.invalid', '', now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'memory-rls-b@example.invalid', '', now(), now());

insert into public.memory_entries (id, user_id, key, value, category, created_at)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'rls-a', 'Account A private memory', 'test', now()),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'rls-b', 'Account B private memory', 'test', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*) from public.memory_entries),
  1::bigint,
  'Account A can read only its own memory rows'
);
select is(
  (select count(*) from public.memory_entries where id = '20000000-0000-4000-8000-000000000002'),
  0::bigint,
  'Account A cannot read Account B memory'
);
select lives_ok(
  $$insert into public.memory_entries (user_id, key, value, category)
    values ('10000000-0000-4000-8000-000000000001', 'rls-a-new', 'Own insert', 'test')$$,
  'Account A can insert a row owned by its JWT identity'
);
select throws_ok(
  $$insert into public.memory_entries (user_id, key, value, category)
    values ('10000000-0000-4000-8000-000000000002', 'rls-a-forged', 'Forged owner', 'test')$$,
  '42501',
  null,
  'Account A cannot insert a row for Account B'
);
select lives_ok(
  $$update public.memory_entries set value = 'Account A updated'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'Account A can update its own row'
);
select is(
  (select count(*) from public.memory_entries
    where id = '20000000-0000-4000-8000-000000000002' and value = 'Account B private memory'),
  0::bigint,
  'Account A cannot update Account B row'
);
select lives_ok(
  $$delete from public.memory_entries where id = '20000000-0000-4000-8000-000000000001'$$,
  'Account A can delete its own row'
);
select is(
  (select count(*) from public.memory_entries where id = '20000000-0000-4000-8000-000000000002'),
  0::bigint,
  'Account A cannot delete Account B row'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.memory_entries),
  1::bigint,
  'Account B sees only its own seeded row after identity switch'
);
select is(
  (select count(*) from public.memory_entries where id = '20000000-0000-4000-8000-000000000001'),
  0::bigint,
  'Account B cannot read Account A row'
);

select * from finish();
rollback;
