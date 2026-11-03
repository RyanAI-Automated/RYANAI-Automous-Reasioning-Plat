import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261103112000_require_registered_auth_users.sql', import.meta.url),
  'utf8',
);

describe('registered-user-only Supabase RLS migration', () => {
  it('adds restrictive gates without replacing existing ownership/member policies', () => {
    expect(migration).toContain('AS RESTRICTIVE FOR ALL TO authenticated');
    expect(migration).toContain("(SELECT (auth.jwt() ->> 'is_anonymous')::boolean) IS FALSE");
    for (const table of [
      'public.conversations',
      'public.memory_entries',
      'public.messages',
      'public.profiles',
      'public.rooms',
      'public.room_members',
      'public.room_messages',
      'public.ryanai_attachment_scans',
    ]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain('ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated');
    expect(migration).toContain('ON realtime.messages AS RESTRICTIVE FOR ALL TO authenticated');
  });

  it('fails closed when the is_anonymous JWT claim is absent', () => {
    expect(migration).toContain("(SELECT (auth.jwt() ->> 'is_anonymous')::boolean) IS FALSE");
    expect(migration).not.toContain('COALESCE((auth.jwt()');
  });
});
