import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261031130000_attachment_update_guard.sql', import.meta.url),
  'utf8',
);

describe('attachment update/upsert security guard migration', () => {
  it('rechecks quotas on inserts and updates while excluding the replaced object from existing totals', () => {
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON storage.objects');
    expect(migration).toContain("IF TG_OP = 'UPDATE' THEN");
    expect(migration).toContain('v_exclude_name := OLD.name');
    expect(migration).toContain('name <> v_exclude_name');
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('revalidates message binding on object updates', () => {
    expect(migration).toContain('public.enforce_ryanai_attachment_message_path()');
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON storage.objects');
  });

  it('resets the scan state after an object is replaced or modified', () => {
    expect(migration).toContain('AFTER INSERT OR UPDATE ON storage.objects');
    expect(migration).toContain('public.enqueue_ryanai_attachment_scan()');
    expect(migration).toContain('Pending is unreadable');
  });
});
