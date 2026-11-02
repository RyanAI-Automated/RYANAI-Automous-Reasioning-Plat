import { createClient } from '@supabase/supabase-js';

type OrphanCandidate = { id: number; bucket_id: string; object_name: string };

const DEFAULT_GRACE_DAYS = 7;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_BATCH_SIZE = 100;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required when attachment orphan cleanup is enabled.');
  return value;
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(name + ` must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function orphanCleanupCutoff(now: Date, graceDays: number): string {
  if (!Number.isSafeInteger(graceDays) || graceDays < 1 || graceDays > 90) {
    throw new Error('ATTACHMENT_ORPHAN_GRACE_DAYS must be an integer between 1 and 90.');
  }
  if (!Number.isFinite(now.getTime())) throw new Error('A valid current date is required.');
  return new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Deletes only old attachment objects whose message row no longer exists.
 * The grace period protects uploads that have not yet been attached to a message.
 */
export function startAttachmentOrphanCleanup(): () => void {
  const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const graceDays = boundedInteger('ATTACHMENT_ORPHAN_GRACE_DAYS', DEFAULT_GRACE_DAYS, 1, 90);
  const intervalMs = boundedInteger('ATTACHMENT_ORPHAN_CLEANUP_INTERVAL_MS', DEFAULT_INTERVAL_MS, 60000, 24 * 60 * 60 * 1000);
  let stopped = false;
  let active = false;

  const cleanup = async () => {
    if (stopped || active) return;
    active = true;
    try {
      const cutoff = orphanCleanupCutoff(new Date(), graceDays);
      const { data, error } = await supabase.rpc('claim_ryanai_orphan_attachment_cleanup', {
        p_created_before: cutoff,
        p_limit: MAX_BATCH_SIZE,
      });
      if (error) throw error;
      const candidates = (data as OrphanCandidate[] | null) ?? [];
      let removed = 0;
      for (const candidate of candidates) {
        if (stopped) break;
        const { error: removeError } = await supabase.storage.from(candidate.bucket_id).remove([candidate.object_name]);
        if (removeError) {
          const { error: auditError } = await supabase
            .from('ryanai_attachment_scans')
            .update({ orphan_cleanup_last_error: removeError.message.slice(0, 300) })
            .eq('id', candidate.id)
            .is('orphan_purged_at', null);
          if (auditError) console.error('[attachment-orphan-cleanup] unable to record failure', auditError.message);
          continue;
        }
        const { error: auditError } = await supabase
          .from('ryanai_attachment_scans')
          .update({ orphan_purged_at: new Date().toISOString(), orphan_cleanup_last_error: null })
          .eq('id', candidate.id)
          .is('orphan_purged_at', null);
        if (auditError) {
          console.error('[attachment-orphan-cleanup] unable to record successful removal', auditError.message);
          continue;
        }
        removed += 1;
      }
      if (removed > 0) console.info('[attachment-orphan-cleanup] unreferenced objects removed', { count: removed });
    } catch (error) {
      console.error('[attachment-orphan-cleanup] cycle failed', error instanceof Error ? error.message : error);
    } finally {
      active = false;
    }
  };

  void cleanup();
  const timer = setInterval(() => void cleanup(), intervalMs);
  console.info('[attachment-orphan-cleanup] enabled', { graceDays, intervalMs });
  return () => { stopped = true; clearInterval(timer); };
}
