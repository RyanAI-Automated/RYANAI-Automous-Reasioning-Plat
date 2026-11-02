# RyanAI conversation attachment storage

RyanAI stores conversation files in the private Supabase Storage bucket `ryanai-attachments`. Message rows retain attachment metadata and object paths; they do not store file bytes or permanent public URLs.

## Enforced limits

The quota migration `20261030130000_attachment_quota_enforcement.sql` defines:

| Limit | Value |
| --- | ---: |
| Individual file | 20 MiB |
| Files per message | 8 |
| Combined files per message | 40 MiB |
| Stored files per account | 500 MiB |
| Upload requests per account | 100 per hour |
| Conversation archive import/export | 250 MiB |

The database quota trigger validates the owner/conversation relationship, uses a transaction-scoped advisory lock for per-account quota checks, and records upload events for a 48-hour rate window. Confirm that the deployed Supabase Storage version populates `storage.objects.metadata->>'size'` as expected before enabling the quotas in staging.

The client validates the extension/MIME allowlist and common file signatures for early feedback. Client checks are not an authorization boundary; Storage policies and database triggers are authoritative.

## Upload, scan and download lifecycle

1. The authenticated client creates a provisional message with a UUID before requesting upload URLs. The message row must exist before Storage insertion.
2. A signed upload URL is created for a unique path: `user UUID/conversation UUID/message UUID/random ID-filename`.
3. The browser sends the original file bytes to the signed URL (not multipart form data), reports byte progress, and supports cancellation.
4. If any file in the batch fails or is cancelled, the client attempts to remove every reserved object path. The user can retry with the retained file selection.
5. Attachment metadata and object paths are persisted against the provisional message after successful upload. Failed persistence attempts clean up uploaded objects and the provisional message where possible.
6. The Storage insert triggers validate quotas, validate the message/conversation path relationship, and enqueue a malware scan.
7. Authenticated reads are allowed only for the owning user/conversation and only after the scan state is `clean`. Infected objects remain private quarantine objects until the retention worker removes their bytes through the Storage API.
8. Downloads/previews use short-lived signed read URLs. Conversation export packages original attachment bytes in a TAR archive; import validates the archive, revalidates files, regenerates IDs/object paths, and creates a separate conversation.

## Database migration order

Apply only in a disposable/local Supabase project first, in this exact order:

1. `20261030120000_private_conversation_attachments.sql` — private bucket and owner/conversation Storage CRUD policies.
2. `20261030130000_attachment_quota_enforcement.sql` — path validation, upload limits and rate accounting.
3. `20261030140000_attachment_malware_scan_quarantine.sql` — scan queue and clean-only authenticated reads.
4. `20261031100000_attachment_quarantine_retention.sql` — infected-object retention audit state.
5. `20261031110000_attachment_orphan_cleanup.sql` — conservative orphan cleanup queue and audit state.
6. `20261031120000_attachment_message_path_guard.sql` — requires the message UUID to exist in the conversation named in the object path.

The scanner and orphan cleanup workers remain opt-in. Do not enable either worker merely because migrations are present. Malware scanning requires a private ClamAV daemon and server-only Supabase service-role credentials. Orphan cleanup independently requires server-only Supabase service-role credentials.

## Required staging acceptance tests

Use two distinct Supabase Auth users (A and B), separate conversations, and messages created before upload.

- As A, upload several allowed file types and verify the stored bytes match the original file hashes.
- As B, attempt to list, download, create a signed read URL, upload with upsert to A's path, update, and remove A's object. Every operation must be denied.
- As A, verify legitimate listing/download and signed URL access after the scan is clean.
- Verify pending, scanning, infected, and failed objects cannot be read or signed for reading.
- Verify invalid owner/conversation/message path IDs and a message from another conversation are rejected; confirm unrelated buckets are unaffected.
- Verify per-file, per-message, per-account and hourly quotas, including concurrent uploads and actual Storage metadata size accounting.
- Exercise upload progress, cancel, retry, partial failure, preview, original download, conversation deletion, export, import, and byte/hash integrity at Android-sized and desktop browser viewports.
- Verify infected-object retention and orphan cleanup only delete eligible objects, use the Supabase Storage API, and preserve audit records.
- Attach HTTP status/error evidence, object state, scan state, and before/after hashes to the issue/release record.

## Backup, rollback and production policy

Before any staging or production migration, take a database backup and object-storage inventory/backup. Rehearse migration application, restore, and rollback in a disposable project using the exact migration set. Restore database and matching object bytes together; verify object counts and representative hashes before reopening uploads.

For a failed rollout, disable the corresponding opt-in worker and block new attachment uploads at the application/configuration layer. Preserve object bytes and scan/audit rows. Never manually delete rows from `storage.objects`; remove bytes through the Supabase Storage API.

No production migration or rollout is authorized by this repository change. Production remains blocked until the two-account tests, Android/desktop E2E, Storage metadata verification, and backup/restore rehearsal are recorded and reviewed.
