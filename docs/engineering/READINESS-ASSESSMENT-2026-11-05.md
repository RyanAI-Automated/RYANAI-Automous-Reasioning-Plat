# RyanAI repository readiness assessment — 5 November 2026

## Scope and evidence rules

This assessment is tied to `main` commit `fcee4fa008188f444cabb91deb3fe71291a3a761`. It is a read-only GitHub-source and status audit. It does not claim that package commands, test suites, workflows, live inference, deployments or hosted acceptance were executed by this assessment.

Evidence is classified as:

- **Source present** — an implementation or configuration is present in the repository.
- **CI evidence** — a GitHub Actions job has a completed result on the exact commit being discussed.
- **Live/staging evidence** — a real runtime, provider, or approved isolated staging action completed and was independently read back.
- **Blocked / unverified** — the necessary evidence or authorization is absent.

A source file, workflow definition, queued check, skipped check, cancelled run, merge, or static configuration flag is not a passing runtime test.

## Repository inventory

The inventory JSON in this directory was generated from the GitHub recursive tree and package manifests at the exact commit above. It contains:

| Item | Count | Interpretation |
|---|---:|---|
| Tracked source-tree entries | 1,149 | GitHub tree count at the pinned commit |
| Package manifests | 3 | Root, MCP server, and workflow worker packages |
| Declared package scripts | 138 | Inventory only; commands were not run |
| GitHub Actions workflow files | 58 | Workflow definitions present; not evidence that they all ran |
| Repository script files | 99 | Source paths under script directories; not evidence of execution |

The JSON records every script and workflow as `NOT_EXECUTED`. It deliberately contains no environment values or secret values. The repository's `scripts/repository-inventory.mjs` remains the reproducible local inventory generator; run it in a clean checkout to compare local filesystem discovery with this pinned GitHub-source snapshot.

## Current exact-main CI and governance snapshot

For main commit `fcee4fa008188f444cabb91deb3fe71291a3a761`, GitHub returned 19 check runs:

- 13 queued;
- 6 skipped / neutral;
- 0 completed successful check runs;
- 0 completed failed check runs.

The combined commit status is **failure** because the `Vercel` context reports `Deployment rate limited — retry in 24 hours.` The absence of completed failures among check runs does not make this green: required jobs remain queued or skipped.

Live ruleset read-back for ruleset `26360956` (`main-protectiona`) shows:

- enforcement is marked active;
- `rules` is empty;
- Integration actor `1144995` has `bypass_mode: always`.

This is not enforceable main protection. The repository has a manual workflow at `.github/workflows/enforce-main-protection.yml` that requires `GH_ADMIN_TOKEN` and the literal confirmation `ENFORCE-MAIN-PROTECTION`. The GitHub integration available to this assessment exposes read-only ruleset access but no ruleset-administration or workflow-dispatch action. An authorized repository administrator must run that existing workflow and verify its final read-back. No policy change was made here.

## Readiness findings by subsystem

### Runtime, persistence and database

**Source present:** the supported persistent API entrypoint is `src/server/launcher.ts`; the reasoning queue in `src/agent/operations.ts` persists before notifying, claims work atomically with `FOR UPDATE SKIP LOCKED`, maintains worker leases/heartbeats, and has retry/recovery behavior. PostgreSQL notification listener/recovery tests are present. PR #1020 limits public queue health details; PR #1021 wires the disposable PostgreSQL notification/recovery test into CI.

**Unverified:** a passing end-to-end runtime result on the current main SHA, live hosted API/MCP/worker readiness, real Redis connectivity, and a verified production PostgreSQL shared-pooler hostname. The pooler host cannot be inferred from the region; it must be copied from the Supabase Project → Connect view and independently matched to the service configuration.

### Specialist workers — issue #682

**Source present:** `src/agent/workerRegistry.ts` defines ten specialist role profiles. The reasoning queue and separate coding-task queue have useful durable execution primitives. `src/engineering/codingTaskQueue.mjs` checks exact independent approval evidence and binds the task to the approved plan, base commit and proposed diff; claims use `FOR UPDATE SKIP LOCKED`, with lease, heartbeat, cancellation and recovery handling.

**Not yet delivered:** the ten profiles are not ten running workers. There is no evidence here of normalized persistent per-specialist assignments, specialist-aware routing, authenticated per-worker progress, and a disposable multi-specialist integration test proving all required paths. The coding-task queue is approval-bound to workbench runs and should not be repurposed as an unapproved generic worker queue. The implementation should extend the existing durable orchestration boundary and preserve user/task isolation.

### RyanAI Studio / IDE — issue #683

**Source present:** the authenticated frontend routes to a conversation-first `CommandCenter`; existing workspace tools are scoped file tools.

**Not yet delivered:** there is no verified Studio IDE route with a real editor, project tree, diagnostics, terminal, test output, preview, Git diff/PR review, and durable-worker activity. No UI should display successful builds or worker progress until backed by actual sandbox execution and assignment events. TypeScript/JavaScript and Python remain the first supported toolchain targets. A Studio implementation must depend on #682 rather than create another queue.

### Attachments and communications — issue #435

**Source present:** private attachment storage/security policies, MIME/signature checks, quotas, signed uploads, scan-gated downloads, quarantine/retention and cleanup logic are present. Relevant merged work includes:

- [PR #1003](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/1003) — local scanner and clean-download integration.
- [PR #1015](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/1015) — wires local Comms callback and attachment scanner tests into disposable Supabase CI.
- [PR #1025](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/1025) — signed-upload reservations, final-size validation, quota checks and delayed scan enqueue.

**Not yet accepted:** two isolated staging users, hosted cross-user denial for list/read/upload/update/delete, real Storage metadata/quota/rate-limit acceptance, a private ClamAV endpoint, full upload/preview/download/retry/cancel/export/import device E2E, and backup/restore evidence. Local fake-ClamAV integration is useful CI evidence but is not hosted malware-service acceptance. Do not run these against the production Supabase project.

### Providers, identity and outbound communications

**Source present:** provider configuration and health state distinguish missing credentials from a live challenge response; auth routes include server-side token verification. WhatsApp/SMS/voice/email and OAuth integration code has source-level coverage.

**Not verified:** independent successful authenticated inference for NVIDIA, Qwen and Logic; actual hosted OAuth code+PKCE/token/JWKS round-trip; verified Twilio/SMTP delivery receipts and durable inbound/outbound message history. No live messages, calls, or provider probes were initiated by this audit.

### Calculator — issue #680

A focused implementation is proposed in [PR #1031](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/1031): authenticated calculator route, bounded arithmetic parser, keypad, decimals/chained operations, clear/backspace, and invalid-input/divide-by-zero handling without `eval`. Its tests and CI are pending. It is not included in the pinned main source commit and should not be described as merged or verified yet.

### Deployment monitor — issue #940

The existing monitor checks PR #936's exact head and public Render health URLs. [PR #1030](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/1030) proposes a fail-closed CI summary: all 13 release-gate contexts must be present and successful before the monitor says `passing`; missing or neutral required checks remain pending. Its Actions checks are queued/pending. The monitor does not access the Render control plane or deploy services.

## Prioritized defect register

| Priority | Area | Evidence / gap | Next safe action |
|---|---|---|---|
| P0 | Main governance | Ruleset has no rules and an always-bypass integration actor | Authorized administrator runs the existing enforcement workflow and verifies read-back |
| P0 | Exact-main CI | 13 queued, 6 skipped, zero completed successes; combined Vercel failure | Resolve CI runner/plan quota issue and obtain full exact-SHA checks; do not bypass |
| P0 | Production runtime | Hosted PostgreSQL pooler endpoint and healthy API/Redis connection unverified | Obtain exact Session Pooler host from Supabase Connect; read-only verify runtime wiring |
| P1 | #682 specialists | Roster exists, but durable per-specialist assignment/progress execution does not | Design and test specialist-aware records/claims on the existing queue |
| P1 | #683 Studio | No full IDE workspace or verified sandbox event wiring | Implement shell only after #682 API contracts; keep execution panels explicitly unavailable until real service events exist |
| P1 | #435 attachments | Local/disposable tests exist; hosted staging acceptance absent | Provision/use an explicitly approved isolated staging environment with two test users and private scanner |
| P1 | Provider and comms | No complete live provider or delivery proof | Perform separately approved live verification using least-privilege credentials |
| P2 | #680 calculator | PR #1031 open; no completed CI/review yet | Validate exact PR head and obtain independent review |
| P2 | #940 monitor | PR #1030 open; exact required-check summarizer not yet verified by CI | Validate exact PR head and obtain independent review |

## Recommended execution order

1. Restore enforceable main protection and obtain completed exact-head CI/security evidence.
2. Verify runtime/database connectivity read-only; resolve the exact Supabase Session Pooler host through the project Connect view.
3. Complete specialist assignment/claim/lease/progress behavior and its disposable multi-worker integration tests (#682).
4. Wire the Studio to those real assignment and sandbox APIs (#683); do not simulate execution.
5. Complete attachment acceptance in an approved isolated staging environment (#435).
6. Complete live provider, identity and communications verification with explicit scope and consent.
7. Re-run complete release-candidate validation and only then revisit production-readiness and deployment decisions (#757, #511).

## Safety record

This report and the accompanying inventory are source/status artifacts only. No production migration, production-data write, secret read or mutation, deployment, service restart, paid upgrade, provider inference, message, call, release, or image publication was performed. No GitHub governance setting was changed. PRs remain subject to independent human review and exact-head CI.
