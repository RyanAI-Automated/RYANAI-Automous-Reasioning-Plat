import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';

const migrationsDirectory = new URL('../../supabase/migrations/', import.meta.url);
const expectedAttachmentMigrations = [
  '20261030120000_private_conversation_attachments.sql',
  '20261030130000_attachment_quota_enforcement.sql',
  '20261030140000_attachment_malware_scan_quarantine.sql',
  '20261031100000_attachment_quarantine_retention.sql',
  '20261031110000_attachment_orphan_cleanup.sql',
  '20261031120000_attachment_message_path_guard.sql',
];

describe('Issue #435 Supabase migration preflight', () => {
  it('keeps every attachment migration present and in timestamp order', () => {
    const files = readdirSync(migrationsDirectory);
    const actual = files.filter((file) => /^202610(?:30|31)\d{8}_.+\.sql$/.test(file));

    for (const migration of expectedAttachmentMigrations) {
      expect(files, `Missing migration: ${migration}`).toContain(migration);
    }

    expect(actual).toEqual([...actual].sort());
    expect(new Set(actual).size).toBe(actual.length);
  });

  it('keeps the attachment migration sequence contiguous in the expected order', () => {
    const files = readdirSync(migrationsDirectory);
    const actual = files.filter((file) => expectedAttachmentMigrations.includes(file));
    expect(actual).toEqual(expectedAttachmentMigrations);
  });
});
