# Issue #435 — attachment security acceptance evidence

## Migration sequence

Apply migrations in this order in a disposable/local Supabase project first:

1. `20261030120000_private_conversation_attachments.sql` — private bucket and owner/conversation Storage CRUD policies.
2. `20261030130000_attachment_quota_enforcement.sql` — path validation, upload limits and rate accounting.
3. `20261030140000_attachment_malware_scan_quarantine.sql` — scan queue and clean-only authenticated reads.
4. `20261031100000_attachment_quarantine_retention.sql` — infected-object retention audit state.
5. `20261031110000_attachment_orphan_cleanup.sql` — conservative orphan cleanup (currently proposed in PR #493; do not apply until merged and reviewed).

The application must not enable scanner or cleanup workers merely because migrations exist. Keep both workers opt-in.

## Rollback and recovery

- Take a database backup and an object-storage inventory/backup before staging or production changes.
- Test rollback only in a disposable project. Dropping the bucket or scan/quota tables is not a safe production rollback because it can orphan or destroy user data.
- For a failed rollout, first disable the corresponding opt-in worker and block new attachment uploads at the application/configuration layer. Preserve object bytes and scan/audit rows.
- Restore the database snapshot and matching object-storage backup together if schema/data restoration is required. Verify object counts and representative hashes before reopening uploads.
- Do not manually delete rows from `storage.objects`; object deletion must use the Supabase Storage API.
- A migration rollback plan must be rehearsed against the exact deployed migration set; this repository change does not execute or prove that rehearsal.

## Issue #435 acceptance matrix

| Acceptance area | Repository evidence | Status / remaining proof |
| --- | --- | --- |
| Multiple uploads | `uploadConversationAttachments`, batch validation, multi-file composer | Implemented; browser/device E2E still required |
| Progress and cancellation | XHR progress, AbortSignal, cleanup on failed batch; unit tests | Unit-tested; browser/device E2E still required |
| Retry / partial failure | Selected files retained after send failure; failed batch cleanup | Partial behavior implemented; explicit per-file partial-failure E2E still required |
| Private storage and owner checks | Private bucket and owner/conversation CRUD policies | SQL policy regression checks added; two-authenticated-account direct API proof still required |
| No cross-account read/download | Clean-only SELECT policy and owner scan gate | Static regression checks added; live Storage API denial tests still required |
| No cross-account overwrite/delete | Owner-scoped UPDATE/DELETE policies | Static regression checks added; live Storage API denial tests still required |
| Safe preview and original download | Short-lived signed URLs; clean scan gate | Helper/unit coverage exists; browser/device E2E still required |
| Persistence and archive round-trip | Attachment metadata, TAR export/import implementation | Automated end-to-end integrity proof still required |
| Limits/provider setup | Quota migration and `docs/SECURE_ATTACHMENT_STORAGE.md` | Documented; verify Storage metadata size in staging |
| Migration, backup and retention review | Ordered migrations and this recovery runbook | Review documented; staging apply/rollback and backup restore not yet evidenced |

## Mandatory staging gate

Before production approval, use two separate Supabase Auth users (A and B) and distinct conversations/messages. Upload a clean object as A at:

`<A-user-uuid>/<A-conversation-uuid>/<A-message-uuid>/<random>-fixture.pdf`

Using B's authenticated client and direct Storage API calls, assert that listing the bucket/prefix, downloading, creating a signed read URL, uploading with upsert to A's path, updating, and removing A's object are all denied. Repeat with A as the owner to prove legitimate access still works. Verify pending/infected/failed objects are not readable and clean objects are readable only by their owner. Record HTTP status/error and object state for each assertion.

Also verify the third path segment references the intended message in the intended conversation. The current quota trigger validates that the segment is a UUID and validates the owner/conversation relationship, but it does not yet query `public.messages` to prove that message belongs to that conversation. Treat that as an outstanding security hardening item until the upload lifecycle is confirmed and a compatible server-side check is added.

Run the Android-sized viewport and desktop browser flows for multi-file upload, progress, cancel, retry, partial failure, previews, original downloads, export and import. No production rollout until these results and a backup/restore rehearsal are attached to the release record.
