import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261102110000_harden_supabase_public_privileges.sql', import.meta.url),
  'utf8',
);

describe('Supabase Data API least-privilege migration', () => {
  it('restricts default table and function grants for both migration owners', () => {
    for (const owner of ['postgres', 'supabase_admin']) {
      expect(migration).toContain(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public`);
    }
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT ALL PRIVILEGES ON TABLES TO service_role');
  });

  it('revokes existing public-table grants before restoring only required authenticated operations', () => {
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE\n    ON TABLE public.profiles TO authenticated');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE\n    ON TABLE public.conversations, public.messages, public.memory_entries');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.rooms TO authenticated');
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.room_members TO authenticated');
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.room_messages TO authenticated');
    expect(migration).toContain('GRANT SELECT ON TABLE public.ryanai_attachment_scans TO authenticated');
    expect(migration).not.toContain('TO anon;');
    expect(migration).not.toContain('TO PUBLIC;');
  });

  it('prevents browser RPC execution of maintenance functions while retaining room RLS helpers', () => {
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON FUNCTION public.handle_new_user()');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON FUNCTION public.rls_auto_enable()');
    for (const signature of ['is_room_member(uuid)', 'is_room_member_topic(text)', 'is_room_owner(uuid)']) {
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`);
    }
  });
});
