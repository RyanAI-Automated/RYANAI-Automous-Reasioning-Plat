# Attachment orphan cleanup

The orphan cleanup worker is separate from malware scanning and remains independently opt-in.

## Eligibility and safeguards

- Only objects in `ryanai-attachments` with a matching scan record are considered.
- The path must match the recorded owner UUID and contain valid conversation and message UUID segments.
- The owning message row must no longer exist for that conversation.
- The default grace period is 7 days (configurable from 1 to 90 days), protecting uploads that have not yet been committed to a message.
- Infected objects are excluded; their separate quarantine retention policy remains authoritative.
- Each cycle claims at most 100 candidates using `FOR UPDATE SKIP LOCKED`.
- Failed removals are retried no more than five times, at least six hours apart.
- Bytes are deleted through the Supabase Storage API. Scan rows remain as audit records with `orphan_purged_at`.

This deliberately favors false negatives over deleting a possibly referenced object. It will not remove an object merely because attachment metadata is absent from a message body; the message row itself must be gone.

## Opt-in configuration

Set `ATTACHMENT_ORPHAN_CLEANUP_ENABLED=true` only after applying the private attachment, malware scan, and orphan cleanup migrations in a staging project and verifying behavior with two accounts.

- `ATTACHMENT_ORPHAN_GRACE_DAYS` (default 7; 1–90)
- `ATTACHMENT_ORPHAN_CLEANUP_INTERVAL_MS` (default 21600000; 60000–86400000)
- Requires server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Does not require ClamAV and does not enable malware scanning.

Back up database and object storage before rollout. Confirm retention/legal requirements, verify that referenced objects are never selected, and test deletion and retry behavior in staging. Do not run cleanup against production until these checks pass.
