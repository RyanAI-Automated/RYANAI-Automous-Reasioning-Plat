import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261105193000_attachment_signed_upload_reservations.sql', import.meta.url),
  'utf8',
);
const commsMigration = readFileSync(
  new URL('../../supabase/migrations/20261105130000_comms_secure_attachments.sql', import.meta.url),
  'utf8',
);

describe('signed Storage upload reservation migration', () => {
  it('accepts only owner-bound size-less INSERT reservations and counts them against the hourly cap', () => {
    expect(migration).toContain("IF v_file_size_text IS NULL THEN");
    expect(migration).toContain("IF TG_OP <> 'INSERT' THEN");
    expect(migration).toContain("IF TG_OP = 'INSERT' AND v_hourly_uploads >= 100 THEN");
    expect(migration).toContain('Attachment conversation does not belong to the path owner');
    expect(migration).toContain('Attachment upload rate limit exceeded');
    expect(migration).toContain('Message attachment count limit exceeded (8 files)');
  });

  it('requires final legacy object updates to include a valid positive size and rechecks quotas', () => {
    expect(migration).toContain('Final attachment upload is missing byte-size metadata');
    expect(migration).toContain('v_file_size <= 0 OR v_file_size > 20 * 1024 * 1024');
    expect(migration).toContain('v_user_bytes + v_file_size > 500 * 1024 * 1024');
    expect(migration).toContain('v_message_bytes + v_file_size > 40 * 1024 * 1024');
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON storage.objects');
  });

  it('requires Comms final object size to match the service-owned metadata reservation', () => {
    expect(migration).toContain('Comms metadata reservation missing');
    expect(migration).toContain('v_file_size <> v_expected_size');
    expect(migration).toContain('Comms owner quota exceeded');
    expect(migration).toContain('Comms per-message quota exceeded');
  });

  it('does not enqueue scans for empty reservations, but rescans finalized updates and replacements', () => {
    expect(migration).toContain("IF COALESCE(v_size_text, '') !~ '^[0-9]+$' THEN");
    expect(migration).toContain('AFTER INSERT OR UPDATE ON storage.objects');
    expect(migration).toContain('ryanai_attachment_scan_enqueue');
    expect(migration).toContain('ryanai_comms_attachment_scan_enqueue');
  });

  it('creates the metadata tables before the Storage triggers can reference them', () => {
    expect(commsMigration).toContain('CREATE TABLE IF NOT EXISTS public.communication_attachments');
    expect(commsMigration).toContain('CREATE TABLE IF NOT EXISTS public.communication_attachment_audit');
    expect(commsMigration).toContain('ADD COLUMN IF NOT EXISTS owner_user_id UUID');
  });
});
