import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261103120000_private_room_policy_helpers.sql', import.meta.url),
  'utf8',
);
const apiConfig = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');

describe('private room policy helper migration', () => {
  it('moves SECURITY DEFINER helpers out of the exposed public schema', () => {
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS private');
    expect(migration).toContain('SET search_path = ''');
    expect(migration).toContain('REVOKE ALL ON SCHEMA private FROM PUBLIC, anon');
    expect(migration).toContain('GRANT USAGE ON SCHEMA private TO authenticated');
    for (const signature of [
      'private.is_room_member(uuid)',
      'private.is_room_owner(uuid)',
      'private.is_room_member_topic(text)',
    ]) {
      expect(migration).toContain(signature);
    }
    expect(migration).toContain('DROP FUNCTION public.is_room_member_topic(text)');
    expect(migration).toContain('DROP FUNCTION public.is_room_member(uuid)');
    expect(migration).toContain('DROP FUNCTION public.is_room_owner(uuid)');
    expect(apiConfig).not.toContain('"private"');
  });

  it('repoints the existing RLS policy dependencies before dropping public helpers', () => {
    for (const policy of [
      'room_members_member_read',
      'room_members_owner_add',
      'room_messages_member_read',
      'room_messages_member_send',
      'rooms_creator_update_name',
      'rooms_member_read',
      'room_chat_member_presence',
      'room_chat_member_receive',
    ]) {
      expect(migration).toContain(`ALTER POLICY ${policy}`);
    }
    expect(migration).not.toContain('DROP FUNCTION public.is_room_member(uuid) CASCADE');
    expect(migration).not.toContain('DROP FUNCTION public.is_room_owner(uuid) CASCADE');
  });
});
