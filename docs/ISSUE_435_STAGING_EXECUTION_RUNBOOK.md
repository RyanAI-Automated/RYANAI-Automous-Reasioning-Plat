# Issue #435 — disposable staging execution runbook

This runbook turns the acceptance matrix in `ISSUE_435_ACCEPTANCE_EVIDENCE.md` into a controlled staging exercise. It is deliberately limited to a **new, disposable Supabase project**. Never point these steps at production.

## Safety boundary

- Create a new Supabase project named for RyanAI attachment acceptance (for example, `ryanai-attachments-acceptance`). Confirm its project reference and dashboard URL before running SQL.
- Do not reuse production project URLs, database passwords, anon keys, service-role keys, Storage buckets, or user accounts.
- Use staging-only credentials in the deployment secret manager or an approved local `.env.local` ignored by Git. Never paste secrets into an issue, PR, chat, test log, screenshot, or shell history.
- Keep the scanner and orphan-cleanup workers disabled until all six migrations are applied and reviewed.
- Keep the project disposable. No real user files or personal data.
- Before any migration, export a database backup and record an object inventory. Verify that both can be retrieved.
- Stop immediately if the project reference does not match the newly created staging project.

## Required staging resources

1. A disposable Supabase project with Auth and private Storage enabled.
2. Two independent Auth users, **A** and **B**, with separate conversations and messages. Store their test credentials securely.
3. A private ClamAV daemon reachable only from the staging API/worker network. Do not expose its TCP port publicly.
4. Staging API environment variables:
   - `SUPABASE_URL` — staging project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` — staging-only service-role key, server-side only.
   - `CLAMAV_HOST` — private DNS name/service address for the staging ClamAV daemon.
   - `CLAMAV_PORT` — staging daemon port (default ClamAV TCP port is 3310 if configured that way).
   - `CLAMAV_TIMEOUT_MS` — bounded scan timeout; use the repository default unless staging measurements justify a change.
   - `ATTACHMENT_SCANNER_ENABLED=true` — enable only for the scanner lifecycle phase after migrations and connectivity checks.
   - `ATTACHMENT_SCAN_INTERVAL_MS` — optional polling interval; use the conservative default initially.
   - `ATTACHMENT_ORPHAN_CLEANUP_ENABLED=true` — keep **false** for initial tests; enable only during its isolated cleanup phase.
   - `ATTACHMENT_ORPHAN_CLEANUP_GRACE_DAYS` and `ATTACHMENT_ORPHAN_CLEANUP_INTERVAL_MS` — only configure when running the isolated orphan-cleanup phase.
5. Test fixtures: a harmless clean PDF, the standard EICAR antivirus test string saved as a test file (never real malware), malformed/oversized files, and a text fixture for hash comparisons.
6. A browser/device test setup for desktop Chromium and a real Android device or Android emulator.

Do not put the service-role key or test-user passwords in frontend variables (anything prefixed `VITE_`), client bundles, or browser storage.

## Preflight — no migrations yet

- Verify the staging project reference in the dashboard and in the API's server-side environment.
- Verify the bucket name `ryanai-attachments` does not contain real data and is configured private.
- Verify Auth users A and B can sign in independently.
- Verify the ClamAV daemon is reachable from the staging worker network, but leave the scanner worker disabled.
- Capture the initial database backup and Storage object inventory; record timestamps and checksums in the private test record.
- Confirm the six migration files below exist on the tested commit and review their SQL before execution.

## Apply migrations in this exact order

Apply one migration at a time to the disposable staging database, checking the result before proceeding:

1. `20261030120000_private_conversation_attachments.sql`
2. `20261030130000_attachment_quota_enforcement.sql`
3. `20261030140000_attachment_malware_scan_quarantine.sql`
4. `20261031100000_attachment_quarantine_retention.sql`
5. `20261031110000_attachment_orphan_cleanup.sql`
6. `20261031120000_attachment_message_path_guard.sql`
7. `20261031130000_attachment_update_guard.sql`

Do not run a blanket migration command while the CLI may be linked to an unknown project. Prefer the Supabase dashboard SQL editor after independently verifying the staging project reference, or explicitly link the CLI to the newly created disposable project and verify the linked reference immediately before applying. Never apply these migrations to production as part of this acceptance run.

After migration, verify the bucket is private; all expected policies, triggers, tables, indexes and RPC grants exist; authenticated users cannot execute service-role scanner RPCs; and existing test objects are not implicitly marked clean.

## Test execution

### 1. Static regression suite

From the repository root on the exact candidate commit:

```sh
npm ci --legacy-peer-deps
npx vitest run src/lib/attachmentStoragePolicy.test.ts src/lib/attachmentQuotaMigration.test.ts src/lib/attachments.test.ts src/server/attachments/scanner.test.ts
```

Record commit SHA, Node/npm versions, command, exit code and complete test summary. These tests are not a substitute for the live checks below.

### 2. Two-account authorization matrix

Create one conversation and one persisted message for A, and a different conversation/message for B. Upload a clean fixture as A to:

```text
<A-user-uuid>/<A-conversation-uuid>/<A-message-uuid>/<random-id>-clean.pdf
```

With B's authenticated session, attempt each operation against A's object/path:

- list the bucket/prefix and enumerate A's objects;
- download/read the object;
- create a signed read URL;
- upload to the same path with upsert enabled;
- update/replace the object;
- remove/delete the object.

Every cross-account operation must be denied. Save sanitized request method, endpoint/path (UUIDs may be pseudonymized consistently), status/error code and timestamp. Do not record bearer tokens or signed URLs.

Repeat legitimate upload, list/read, signed download and delete as A. Verify the object remains unreadable until its scan status is `clean`.

### 3. Path and message binding

Test valid owner/conversation/message UUIDs. Then test malformed UUIDs, a nonexistent message, a message belonging to another conversation, a conversation owned by B with A's owner segment, and extra/missing path segments. All invalid paths must be rejected. Also test upsert/update behavior explicitly; do not infer UPDATE protection from INSERT tests.

### 4. Upload and quota behavior

Verify:
- 20 MiB per-file limit;
- 8 files per message;
- 40 MiB per message;
- 500 MiB per account;
- 100 uploads per account per hour;
- 250 MiB archive import/export cap;
- concurrent uploads near each quota boundary, including simultaneous requests from the same account.

Check the actual `storage.objects.metadata->>'size'` value produced by the staging Storage service for signed uploads. Compare accepted/rejected operations with quota accounting. Verify failed, cancelled and retried uploads do not leave orphaned metadata or incorrectly consume quota.

### 5. ClamAV lifecycle

Only after migration review and ClamAV connectivity verification, enable the scanner in staging. Test:
- clean fixture -> scan record transitions to `clean` -> owner can read/download;
- EICAR fixture -> `infected` -> object remains quarantined and unreadable;
- pending/scanning -> unreadable;
- daemon unavailable, timeout, malformed response and exhausted retries -> `failed` or retry state according to implementation, always unreadable;
- stale scanning lease recovery and maximum attempt behavior.

Confirm scan rows, object state and audit timestamps. Never use live malware samples.

### 6. Retention and orphan cleanup

Keep orphan cleanup disabled until the separate phase. Create disposable test objects for eligible orphan, recent object, infected object, and object with an existing message. Enable the worker only in staging with the documented grace period. Confirm only eligible objects are removed through the Supabase Storage API; infected, recent and message-backed objects remain. Verify retry/idempotency and audit records. Disable the worker after the test.

### 7. Desktop and Android E2E

At desktop Chromium and Android viewport/device:
- select and send multiple attachments;
- verify byte progress, cancellation, retry and partial-batch failure;
- preview and download clean files; confirm pending/infected/failed files cannot be read;
- delete message/conversation and verify expected object cleanup;
- export and import a conversation archive, then compare original attachment SHA-256 hashes with imported bytes;
- test slow network, interrupted upload, refresh/reopen, and responsive layout.

Use synthetic fixtures only. Capture screenshots with tokens, user identifiers and signed URLs redacted.

### 8. Backup, restore and rollback rehearsal

- Take a fresh database backup and object inventory after the test dataset is prepared.
- Restore the database and objects into a second disposable project or isolated restore target.
- Verify message metadata, scan/quarantine rows, object bytes and SHA-256 hashes.
- Rehearse rollback only in a disposable project using a written, reviewed rollback plan. Do not drop shared bucket data or scan/quota records as a shortcut.
- Verify the restored environment can serve only clean authorized objects and that failed rollback leaves original staging evidence intact.

## Evidence record template

Store the completed record in a private staging evidence location. Publish only sanitized results to the issue.

| Field | Value |
| --- | --- |
| Candidate commit SHA | |
| Staging project reference (redacted) | |
| Migration order and timestamps | |
| Database backup reference/checksum | |
| Storage inventory reference/checksum | |
| Account A/B test result | |
| Cross-account read/list/signed URL result | |
| Cross-account upsert/update/delete result | |
| Quota/concurrency result | |
| ClamAV clean/infected/pending/failed result | |
| Retention/orphan cleanup result | |
| Desktop browser and version | |
| Android device/emulator and version | |
| Archive round-trip SHA-256 result | |
| Restore/rollback result | |
| Failed cases and follow-up issue links | |
| Operator and review sign-off | |

## Exit criteria

Issue #435 stays open until every required acceptance row has reproducible evidence, all cross-account operations are denied, only clean authorized objects are readable, quotas hold under concurrency, scanner failure is fail-closed, Android/desktop flows pass, and backup/restore/rollback is rehearsed. Any failed security assertion blocks acceptance.

**This runbook does not authorize production migrations, production secrets, production worker activation, or production deployment.**
