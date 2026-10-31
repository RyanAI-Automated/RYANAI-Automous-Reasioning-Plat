# Quarantined attachment retention

The opt-in attachment scanner retains infected objects in the private bucket while they are quarantined. When the scanner worker is enabled, it also runs a bounded retention purge at a configurable interval.

## Defaults and controls

- Default quarantine retention: 30 days from the completed infected scan.
- Configure with `ATTACHMENT_QUARANTINE_RETENTION_DAYS` (integer 1–3650).
- Purge cycle defaults to once per hour; configure with `ATTACHMENT_QUARANTINE_PURGE_INTERVAL_MS` (60,000–86,400,000 ms).
- Each cycle processes at most 25 objects.
- Objects are removed only through the Supabase Storage API. The worker never deletes rows directly from `storage.objects`.
- Scan records are retained with `purged_at` populated for audit. Object paths and signed URLs are not written to logs.

A Storage removal failure leaves the audit marker unset and is retried in a later cycle. If Storage deletion succeeds but recording the audit timestamp fails, the next cycle safely retries the removal and audit update.

## Rollout requirements

This worker remains opt-in. Apply the malware quarantine migration first, then this retention migration, only after reviewing and testing them in a staging Supabase project. Provision a private ClamAV endpoint and server-only Supabase service-role credentials before enabling the worker. Back up database and bucket data, verify retention/legal requirements, and test with two separate accounts before production enablement.

This retention process purges infected objects only. It is not a general orphan-object cleaner and does not automatically delete clean attachments or conversation data.
