# Issue #435 — disposable staging execution runbook

This runbook defines a controlled acceptance exercise for a **new, disposable Supabase project**. It does not authorize production changes.

## Safety boundary

- Use a newly created staging project with a separately verified project reference. Never use production URLs, passwords, keys, buckets, users, or data.
- Keep staging credentials in a secret manager or ignored local environment file. Never paste secrets, bearer tokens, signed URLs, or passwords into issues, PRs, chat, logs, or screenshots.
- Use synthetic files and two independent Auth users (A and B). No real user data.
- Take and verify a database backup and Storage object inventory before migration/testing.
- Stop if the project reference or CLI link is not the intended disposable staging project.
- Do not enable scanner or orphan-cleanup workers until their relevant migration and connectivity checks have passed.

## Required staging resources

1. Disposable Supabase project with Auth and private Storage.
2. Two independent Auth users A and B, each with separate conversations/messages.
3. Private ClamAV daemon reachable only from the staging API/worker network.
4. Staging-only server environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, scanner and cleanup flags/intervals. Never expose service-role credentials in frontend variables or browser storage.
5. Synthetic clean PDF, EICAR test fixture (not live malware), malformed/oversized files, and hash fixture.
6. Desktop Chromium and Android browser/device test capability.

## Preflight — read-only

- Confirm staging project reference in Supabase Dashboard.
- Confirm the API uses that exact staging URL and staging-only credentials.
- Confirm Auth users A and B can sign in independently.
- Verify ClamAV network reachability but leave scanner disabled.
- Capture and verify backup and Storage inventory.
- Review all migration SQL on the exact candidate commit.
- Inspect local and staging migration history before applying anything. Do not assume the remote database is empty or that the far-future legacy migration is absent.

## Migration sequence

The attachment feature has seven schema/policy migrations. PR #504 adds a separate least-privilege corrective migration. The full fresh-install order on the current main branch is:

1. `20261030120000_private_conversation_attachments.sql`
2. `20261030130000_attachment_quota_enforcement.sql`
3. `20261030140000_attachment_malware_scan_quarantine.sql`
4. `20261031100000_attachment_quarantine_retention.sql`
5. `20261031110000_attachment_orphan_cleanup.sql`
6. `20261031120000_attachment_message_path_guard.sql`
7. `20261031130000_attachment_update_guard.sql`
8. `20261031150000_least_privilege_public_grants.sql` — PR #504 corrective grants
9. `99999999999999_post_grants.sql` — legacy far-future migration; its current contents are also least-privilege.

**Migration-history compatibility warning:** the legacy migration's version sorts after every normal timestamp. A database that already recorded `99999999999999` may regard the PR #504 corrective migration as an out-of-order pending migration. Do not silently skip it, manually change migration history, or run a blanket push. First compare local and staging migration lists and inspect the exact pending versions. If the corrective migration is pending behind the recorded far-future version, use the Supabase CLI's documented include-all behavior only after confirming the target is the disposable staging project and reviewing the exact SQL to be applied. Record the before/after migration lists. Never use `migration repair` as a shortcut.

**Migration execution must go through the Supabase CLI migration workflow** so the migration ledger is updated. Do not paste migration files into the Dashboard SQL Editor as a substitute: executing SQL there does not provide the normal CLI migration-history workflow. Never use a linked command until the staging project reference has been independently verified. No production project may be linked or targeted for this exercise.

For a fresh local database, use an isolated local Supabase stack and inspect `supabase migration list --local` before/after reset. A local reset is destructive to that local database; use only a disposable local database with no data to preserve.

After application, verify the bucket is private; expected policies, triggers, tables, indexes and RPC grants exist; authenticated clients cannot execute service-role scanner operations; the `postgres` creator role's `public` default table ACL grants no privileges to `PUBLIC`, `anon` or `authenticated`; and existing objects are not implicitly marked clean. This default-ACL check protects future tables created by the migration owner; other schema-owner roles must be reviewed separately if they create Data API tables.

## Automated isolated validation

The `issue-435-supabase` job in `.github/workflows/ci.yml` runs the six focused Vitest files and starts a disposable local Supabase stack in GitHub Actions. It performs a fresh migration reset, checks all nine migration versions and key grants/private-bucket properties, then builds a far-future-history fixture in that disposable database and uses `supabase migration up --local --include-all` to apply the pending corrective migration. The fixture edits only the ephemeral CI migration ledger to model an older installation; it does not use `migration repair`, link a hosted project, or contact production. A green workflow is evidence for local migration execution and focused tests only; it is not staging two-account acceptance.

## Test execution

### 1. Static regression suite

Run on the exact candidate commit:

```sh
npm ci --legacy-peer-deps
npx vitest run \
  src/lib/leastPrivilegeGrantsMigration.test.ts \
  src/lib/attachmentStoragePolicy.test.ts \
  src/lib/attachmentQuotaMigration.test.ts \
  src/lib/attachmentUpdateGuardMigration.test.ts \
  src/lib/attachments.test.ts \
  src/server/attachments/scanner.test.ts
```

Record commit SHA, Node/npm versions, command, exit code, and full test summary. Static/text assertions are not proof that PostgreSQL accepts the migrations or that live Storage authorization works.

### 2. Two-account authorization matrix

Create a conversation and persisted message for A, and separate ones for B. Upload as A to:

```text
<A-user-uuid>/<A-conversation-uuid>/<A-message-uuid>/<random-id>-clean.pdf
```

As B, attempt to list/enumerate, download, create a signed read URL, upload with upsert, update/replace, and delete A's object. Every cross-account operation must be denied. Repeat legitimate operations as A. Save sanitized methods, paths, status/error codes and timestamps; never record credentials or signed URLs.

### 3. Path and message binding

Test valid owner/conversation/message UUIDs, malformed UUIDs, nonexistent messages, messages belonging to another conversation, another user's conversation with A's owner segment, and extra/missing path segments. Invalid paths must be rejected. Test UPDATE/UPSERT explicitly, not just INSERT.

### 4. Upload and quota behavior

Verify 20 MiB/file, 8 files/message, 40 MiB/message, 500 MiB/account, 100 uploads/account/hour, and 250 MiB archive cap. Exercise concurrent requests near quota boundaries. Inspect actual Storage object metadata size and compare it with quota accounting. Verify failed/cancelled/retried uploads do not incorrectly consume quota or leave metadata orphans.

### 5. ClamAV lifecycle

Only after migrations and connectivity pass, enable scanner in staging. Verify clean -> clean/readable; EICAR -> infected/quarantined/unreadable; pending/scanning -> unreadable; daemon outage, timeout, malformed response and exhausted retries -> failed/retry but always unreadable. Test stale lease recovery and maximum attempts. Never use live malware.

### 6. Retention and orphan cleanup

Keep cleanup disabled until its isolated phase. Create synthetic eligible orphan, recent, infected, and message-backed objects. Enable cleanup only in staging with the documented grace period. Confirm only eligible objects are removed through the Storage API; others remain. Verify idempotency/audit records, then disable the worker.

### 7. Desktop and Android E2E

Test multi-file selection/send, previews, progress, cancel/retry, partial-batch failures, clean downloads, blocked pending/infected/failed files, deletion cleanup, archive import/export with SHA-256 comparison, slow/interrupted network, refresh/reopen, and responsive layout. Use synthetic fixtures only; redact identifiers and signed URLs from evidence.

### 8. Backup, restore and rollback

Back up the prepared test database and object inventory. Restore to a second disposable target; verify message metadata, scan/quarantine rows, object bytes and SHA-256 hashes. Rehearse rollback only in a disposable project with a reviewed plan. Confirm the restored environment serves only clean, authorized objects.

## Evidence record

Store detailed evidence privately and publish sanitized results only:

| Field | Value |
| --- | --- |
| Candidate commit SHA | |
| Staging project reference (redacted) | |
| Local migration list before/after | |
| Staging migration list before/after | |
| Applied migration order and timestamps | |
| Backup and Storage inventory checksums | |
| Account A/B authorization results | |
| Cross-account list/read/signed URL/upsert/update/delete results | |
| Quota and concurrency results | |
| ClamAV clean/infected/pending/failed results | |
| Retention/orphan cleanup results | |
| Desktop browser/device and version | |
| Android device/emulator and version | |
| Archive round-trip SHA-256 result | |
| Restore/rollback result | |
| Failed cases, follow-up issues, operator/reviewer sign-off | |

## Exit criteria

Issue #435 remains open until every acceptance row has reproducible evidence; all cross-account operations are denied; only clean authorized objects are readable; quotas hold under concurrency; scanner failures are fail-closed; desktop and Android flows pass; and backup/restore/rollback is rehearsed. Any failed security assertion blocks acceptance.

**This runbook does not authorize production migrations, production secrets, production worker activation, or production deployment.**
