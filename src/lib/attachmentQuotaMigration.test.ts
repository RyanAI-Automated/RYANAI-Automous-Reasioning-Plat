import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261030130000_attachment_quota_enforcement.sql', import.meta.url),
  'utf8',
);

describe('private attachment quota migration', () => {
  it('declares the documented per-file, per-message, account, and hourly limits', () => {
    expect(migration).toContain('20 * 1024 * 1024');
    expect(migration).toContain('v_message_files >= 8');
    expect(migration).toContain('40 * 1024 * 1024');
    expect(migration).toContain('500 * 1024 * 1024');
    expect(migration).toContain('v_hourly_uploads >= 100');
  });

  it('serializes quota checks and verifies the owner-conversation relationship', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('conversation.user_id = v_user_id');
    expect(migration).toContain('BEFORE INSERT ON storage.objects');
  });

  it('keeps upload-event history private and bounded', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.ryanai_attachment_upload_events');
    expect(migration).toContain("created_at < now() - interval '48 hours'");
  });
});
