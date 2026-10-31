import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { orphanCleanupCutoff } from './orphanCleanup';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261031110000_attachment_orphan_cleanup.sql', import.meta.url),
  'utf8',
);

describe('attachment orphan cleanup policy', () => {
  it('uses the configured grace period to calculate a deterministic cutoff', () => {
    expect(orphanCleanupCutoff(new Date('2026-10-31T12:00:00.000Z'), 7))
      .toBe('2026-10-24T12:00:00.000Z');
  });

  it('rejects unsafe grace periods and invalid clocks', () => {
    expect(() => orphanCleanupCutoff(new Date('2026-10-31T12:00:00.000Z'), 0)).toThrow(
      'ATTACHMENT_ORPHAN_GRACE_DAYS must be an integer between 1 and 90.',
    );
    expect(() => orphanCleanupCutoff(new Date('2026-10-31T12:00:00.000Z'), 91)).toThrow(
      'ATTACHMENT_ORPHAN_GRACE_DAYS must be an integer between 1 and 90.',
    );
    expect(() => orphanCleanupCutoff(new Date('invalid'), 7)).toThrow('A valid current date is required.');
  });

  it('only claims old objects whose message row is missing', () => {
    expect(migration).toContain("s.bucket_id = 'ryanai-attachments'");
    expect(migration).toContain("s.status <> 'infected'");
    expect(migration).toContain('s.created_at < p_created_before');
    expect(migration).toContain('NOT EXISTS (');
    expect(migration).toContain('FROM public.messages m');
    expect(migration).toContain('m.conversation_id::text = split_part(s.object_name, \'/\', 2)');
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('s.orphan_cleanup_attempts < 5');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup');
  });

  it('does not delete storage metadata directly', () => {
    expect(migration).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
  });
});
