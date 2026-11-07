# Follow-up repair plan: Agent API tests, Prisma baseline, Render source, security tests, Railway staging

**Prepared:** 2026-11-07, against `main` at `a7fc0b3` (#1148)
**Status:** Proposal only. Human review required. No auto-merge.
**Scope of this document:** it changes no cloud resource, runs no migration, triggers no deployment, and touches no secret. Each section says what is already known, what is blocked, and what the implementation PR must prove.

## 0. Ground rules for the implementation PR

- Branch from current `main`. Re-fetch `main` before opening and rebase if it moved.
- One PR, review required, no auto-merge. Separate commits per section so each can be reverted alone.
- Docs, tests and proposal SQL only unless a section says otherwise. Migration SQL is added under `docs/` as a proposal and is not placed in `prisma/migrations/` or `supabase/migrations/` until approved.
- Nothing in the PR may call a Render, Railway or Supabase management API with a write verb.

## 1. The 15 failing Agent API regression tests

**Known.** The last completed `Agent API Regression Tests` run on `main` (run 42369668582, commit `1c40e3a`) had 18 failing tests in 13 files, before #1148 merged. The runs for `a7fc0b3` were still queued or pending when this was written, so the current 15 are not yet visible. Do not assume they are a subset of the 18.

Files with failures in the `1c40e3a` run:

| File | Failing area |
|---|---|
| `src/App.test.tsx` | Admin Console block for non-admin users |
| `src/components/CommunicationsCenter.test.tsx` | inbox search, file selection and scan-gated sharing, workspace metrics, conversation intelligence |
| `src/components/Greeting.test.tsx` | legacy welcome-panel title and voice |
| `src/lib/attachmentMessagePersistence.test.ts` | message-before-upload ordering, metadata-after-upload, rollback |
| `src/pages/Dashboard.test.tsx` | Settings visible while filtering workspace cards |
| `src/pages/ProfileSettings.test.tsx` | privileged toggles, trusted-role workspaces, preference persistence |
| `src/telemetry/queueContext.test.ts` | queue trace context restore |
| `src/server/comms/historyRoutes.test.ts` | history ordering, limit cap |
| `src/server/routes/auth.test.ts` | predeclared `authUser` decorator |
| `src/server/routes/memory.test.ts` | account-scoped memory list |
| `scripts/ryanai-monitor-ci.test.cjs`, `scripts/security-schema-contract.test.mjs`, `scripts/verify-node-ca.test.mjs` | whole-file failures, likely load or environment errors |

**Method (per test, not per file).** For each failing test, record one of three verdicts before editing anything:

1. **Implementation wrong.** The test states the intended contract and the code violates it. Fix the code. Security-relevant cases (`auth.test.ts` returning 200 where 401 is expected, the Admin Console block, privileged toggles) default to this verdict until proven otherwise.
2. **Test stale.** The contract legitimately changed. Update the test and cite the commit or doc that changed the contract.
3. **Environment.** The test fails for a reason unrelated to its contract (missing env, ordering, CI-only service). Fix the harness.

The PR description carries a table of test name, verdict, evidence, and fix. A test is never loosened to pass without a verdict of 2 or 3 and its evidence.

**Blocked on:** the `a7fc0b3` run finishing. Re-pull with `gh run view <id> --log-failed` and rebuild the list above.

## 2. Prisma migration baseline

**Known.** `prisma/migrations/` holds 40+ migrations from `20261015081513_init_reasoning_platform` to `20261106000000_security_centre_core`. `scripts/audit-prisma-migration-readiness.mjs` is already a read-only audit: it compares local migration names with `_prisma_migrations` and checks required columns, tables and vector indexes, and it never prints `DATABASE_URL`. #1148 removed one redundant migration, so the local list changed.

**Blocked on:** `Database Schema Validation` and `Disposable Prisma and pgvector Upgrade Test` finishing on `a7fc0b3`. Both were queued or pending.

**Plan once they pass:**

1. Treat the disposable-database result as the baseline for a clean replay of every migration.
2. Run the audit script against the target database with a read-only role. Output: `pending` and `databaseOnly` lists.
3. For a database that already has the schema but no history, propose `prisma migrate resolve --applied <name>` for each migration the audit proves is already in effect. Emit these as a reviewed list, not as a script that runs.
4. For `databaseOnly` names, stop and investigate. Never delete rows from `_prisma_migrations`.

Production gets no `migrate deploy` or `migrate resolve` from this PR.

## 3. Render deployment-source reconciliation (proposal, no deploy)

**Known drift.** `render.yaml` sets `autoDeployTrigger: off` for `ryanai-web` and `ryanai-api`. The 2026-11-05 inventory in `render-primary-railway-backup-deployment-plan.md` recorded both live services as auto-deploying on commit to `main`. A merge to `main`, including #1148, may therefore have started a production deploy. Check the Render dashboard deploy history for `a7fc0b3` first.

**Reconciliation steps (read-only until approved):**

1. Fetch each live service's repository, branch, root directory, Dockerfile path, health path, and auto-deploy setting using read-only `GET` calls on the Render API. Diff against `render.yaml`.
2. Confirm the repository URL on each service is `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat` and not another fork or the other RyanAI repository.
3. Produce a drift table: field, live value, `render.yaml` value, recommended direction.
4. Recommend setting live auto-deploy to match the file (`off`) as a manual dashboard change by the owner. Do not run a Blueprint sync, since it can create or modify resources, including the Key Value instance.
5. Leave the legacy `RYANAI-Automous-Reasioning-Plat` service alone.

**Needs from the owner:** a read-only Render API key, or a dashboard export.

## 4. Security migration proposals and tests

**Known.** Existing migrations already follow a pattern: `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `SECURITY DEFINER` with a pinned `search_path`, and `GRANT EXECUTE ... TO service_role`. `scripts/security-schema-contract.test.mjs` checks the Security Centre migration by regex on SQL text, which proves wording but not behaviour.

**Proposal.** Add behavioural SQL tests that run in the disposable Postgres of `database.yml`, using the same `anon`, `authenticated` and `service_role` role setup as `agent-regression.yml`:

| Test | Assertion |
|---|---|
| Explicit ownership | With `SET ROLE authenticated` and a JWT `sub` of user A, reads and writes on user B's rows return zero rows or an error. Run for every table with a user or owner column. |
| Anonymous user | With `SET ROLE anon`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` on every `public` table fail with permission denied. |
| Function execution | For every `SECURITY DEFINER` function in `public`, `has_function_privilege` is false for `anon`, `authenticated` and `PUBLIC`, and true only for `service_role` where the design says so. Also assert each has a non-empty `proconfig` containing `search_path`. |
| Default privileges | A newly created table in `public` is not readable by `anon` or `authenticated`. |

Any gap these tests find becomes a separate proposal SQL file under `docs/operations/proposed-migrations/`, with the failing assertion quoted. None is applied by this PR.

## 5. Railway staging verification plan (preserving persistent memory)

**Known.** `railway.json` builds `Dockerfile.api` with `/health`. `deploy-railway.yml` is gated on a manual `STAGE` input, open-PR-head SHA, ten named passing checks, isolated project and service IDs, and it refuses the existing unrelated project `fc58568d-...`. Persistent memory lives in `public.agent_memory` and `public.reasoning_cache` (migration `20261104100000_vector_memory`, with an HNSW index and `session_id`).

**Verification plan, in order:**

1. **Isolation.** Confirm `DATABASE_URL` for the staging service points to a staging database, never the production one. Compare host and database name only; never print the full URL.
2. **Pgvector.** Confirm the `vector` extension exists on the staging database before any deploy.
3. **Memory preservation.** Before the first staging deploy, row counts of `agent_memory` and `reasoning_cache` are recorded with a read-only query. After each deploy and each restart, the counts must be equal or higher. A deploy that lowers them is a failure.
4. **Persistence layer.** State whether memory persists through the Railway Postgres service volume or an external database. A container filesystem is not acceptable storage.
5. **Redis.** Staging uses its own Redis. No shared queue with Render.
6. **Safety flags.** Keep `SCHEDULER_ENABLED`, `ALERTS_ENABLED`, `COMMUNICATIONS_ENABLED`, and attachment scanning off, as in `render.staging.yaml`.
7. **Schema.** Run `scripts/audit-prisma-migration-readiness.mjs` against staging, read-only.
8. **Health.** `GET /livez`, `/readyz`, `/health` pass, and `/readyz` reports PostgreSQL, Redis, checkpointer and queue listener healthy.

Railway stays a backup platform. Nothing here switches traffic.

## Out of scope

Production deployment, production migration, secret creation or rotation, DNS, paid-plan changes, traffic failover.
