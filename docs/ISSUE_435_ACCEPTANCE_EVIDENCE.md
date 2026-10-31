# Issue #435 — attachment security acceptance evidence

## Implemented repository changes

The following code is merged on `main`:

- PRs #441 and #444: private bucket, owner/conversation-scoped Storage policies, allowlist/signature validation, metadata persistence, multi-file composer, signed links, and conversation deletion cleanup.
- PR #475: TAR export with Markdown transcript, versioned manifest, and original attachment bytes.
- PR #476: validated TAR import into a new conversation, regenerated IDs, revalidation, and partial rollback.
- PRs #477/#478: XHR byte progress, cancellation, failed-batch cleanup, retained-file retry, and regression assertion correction.
- PR #479: quota/storage rollout documentation and static migration regression tests.
- PR #491: scanner resource-use hardening.
- PR #492: quarantine retention controls.
- PR #493: opt-in conservative orphan cleanup worker.
- PR #494: attachment security regression gates and this acceptance record.
- PR #495: message-path guard requiring the message to exist in the path's conversation.
- PR #496: persist provisional message before Storage upload and roll back on failure.
- PR #497/#498: scanner Supabase client typing and zero-warning lint correction.

## Migration order

Apply only in a disposable/local Supabase project first:

1. `20261030120000_private_conversation_attachments.sql`
2. `20261030130000_attachment_quota_enforcement.sql`
3. `20261030140000_attachment_malware_scan_quarantine.sql`
4. `20261031100000_attachment_quarantine_retention.sql`
5. `20261031110000_attachment_orphan_cleanup.sql`
6. `20261031120000_attachment_message_path_guard.sql`

Do not enable the scanner or orphan-cleanup worker until its schema is applied and its service dependencies are configured. The message must be persisted before object upload; the path guard rejects uploads whose message does not exist in the named conversation.

## Acceptance matrix

| Acceptance area | Repository evidence | Remaining evidence |
| --- | --- | --- |
| Multi-file upload | Composer, batch validation and storage helper | Android and desktop browser E2E |
| Progress, cancel, retry | XHR progress, AbortSignal, retained files, cleanup tests | Device/browser E2E and partial-failure scenario |
| Private storage and owner checks | Private bucket and owner/conversation Storage policies | Live two-account direct Storage API tests |
| Cross-account read/download | Clean-only SELECT policy and scan gate | Prove B cannot list/read/sign A's objects |
| Cross-account overwrite/delete | Owner-scoped Storage policies | Prove B cannot upsert/update/remove A's objects |
| Message/conversation binding | Message path trigger and persistence-before-upload flow | Apply in disposable Supabase; valid and invalid path tests |
| Malware quarantine | Scan queue, worker, clean-only read policy | Live ClamAV clean/infected/pending/failed lifecycle |
| Quarantine retention | Opt-in retention worker and audit columns | Staging retention run and byte/audit verification |
| Orphan cleanup | Opt-in conservative worker and claim RPC | Staging run, retry/idempotency and object/audit verification |
| Quotas | Per-file/message/account/hour database trigger | Verify Storage metadata size and concurrent quota behavior |
| Preview/download | Short-lived signed read URL and scan gate | Android/desktop browser E2E |
| Export/import integrity | TAR manifest, validation and regenerated paths | Full round-trip byte/hash test in integration environment |
| Backup and rollback | Documented migration order and recovery procedure | Actual backup, restore and rollback rehearsal |

## Mandatory two-account staging protocol

Create two independent Supabase Auth users A and B and distinct conversations/messages. Upload a clean fixture as A using a path shaped as:

`<A-user-uuid>/<A-conversation-uuid>/<A-message-uuid>/<random>-fixture.pdf`

With B's authenticated client, attempt bucket/prefix listing, download, signed read URL creation, upload with upsert to A's path, update, and remove. Every operation must be denied. Repeat legitimate operations as A and verify they work only after the scan is clean. Confirm pending/scanning/infected/failed objects remain unreadable. Verify the path's third UUID references a message belonging to the second UUID conversation.

Record each request, HTTP status/error, scan state, object state, and file hash. Run upload/cancel/retry/partial failure, preview/download, delete, export/import, and responsive layout flows at Android-sized and desktop viewports.

## Rollout decision

**Not approved for production yet.** This repository record does not claim that Supabase migrations have been applied, that two-account API tests have run, or that staging E2E and backup/restore rehearsal have passed. No production migration, secret change, worker enablement, or deployment is performed by this change.
