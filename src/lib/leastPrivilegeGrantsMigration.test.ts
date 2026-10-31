import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261031150000_least_privilege_public_grants.sql', import.meta.url),
  'utf8',
);
const legacyMigration = readFileSync(
  new URL('../../supabase/migrations/99999999999999_post_grants.sql', import.meta.url),
  'utf8',
);
const seed = readFileSync(
  new URL('../../supabase/migrations/seed.sql', import.meta.url),
  'utf8',
);

describe('least-privilege Supabase grants', () => {
  it('revokes client access from existing and future public tables', () => {
    for (const sql of [migration, legacyMigration]) {
      expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated');
      expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public');
      expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated');
      expect(sql).toContain('GRANT ALL PRIVILEGES ON TABLES TO service_role');
      expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE');
      expect(sql).toContain('public.profiles, public.conversations, public.messages, public.memory_entries');
    }
  });

  it('keeps attachment scanner state read-only to clients and upload events private', () => {
    expect(migration).toContain('GRANT SELECT ON TABLE public.ryanai_attachment_scans TO authenticated');
    expect(migration).not.toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ryanai_attachment_scans');
    expect(migration).not.toContain('GRANT SELECT ON TABLE public.ryanai_attachment_upload_events');
  });

  it('removes the blanket grant pattern from clean installs and seed guidance', () => {
    expect(legacyMigration).not.toContain('GRANT SELECT ON TABLE public.%I TO anon');
    expect(legacyMigration).not.toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated');
    expect(seed).not.toContain('grant_public_table_access');
    expect(seed).not.toContain('GRANT SELECT ON public.example_table TO anon');
  });
});
