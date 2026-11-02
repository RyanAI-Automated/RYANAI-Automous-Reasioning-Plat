# Isolated database environments for RyanAI engineering

## Design reference

This design draws on Databricks' [Lakebase branching CI/CD lessons](https://www.databricks.com/blog/lakebase-branching-cicd-lessons-100-pr-databases): one isolated database per PR/task, migration and integration tests against that environment, and automatic cleanup with a time-to-live backstop. The same principle applies without adopting Lakebase as RyanAI's database provider.

RyanAI currently uses Supabase PostgreSQL. Supabase Branching provides isolated preview projects with separate database/API credentials. Preview branches are data-less by default and are intended for PR validation. Branching usage is billable and availability depends on the Supabase plan/configuration; do not enable it or create branches until the owner approves the cost and access model.

## Target PR lifecycle

1. PR opens or receives a new commit.
2. A trusted CI identity provisions (or waits for the Supabase GitHub integration to provision) a preview branch for that PR.
3. CI obtains branch-scoped credentials from the trusted integration/secret context. Credentials are never written to artifacts or PR logs.
4. Run migrations and schema validation against that preview branch only.
5. Run integration/regression tests against deterministic, sanitized seed data. No production rows or Storage objects are copied by default.
6. Publish migration/schema diff and test evidence to the PR.
7. On PR close/merge, delete the preview branch. Set a TTL as a backstop for abandoned branches.
8. Production migration remains a separate reviewed promotion step after merge; agent workers cannot trigger it.

## Safety rules

- Production `DATABASE_URL` is never available to PR code or untrusted fork workflows.
- If an isolated database is unavailable, database integration checks must fail or be explicitly reported as skipped; they must never fall back to production.
- Use least-privilege branch credentials and short-lived CI identity where supported.
- Preview branches start data-less. Use synthetic fixtures; if production-derived data is ever proposed, require a separate privacy review and masking plan.
- Migration tests include fresh install, upgrade from current migration state, rollback/forward compatibility where supported, RLS/privilege checks and schema diff.
- Every branch has a cleanup path and TTL. Cleanup failure is an alert, not a silent pass.
- No schema merge, production migration, paid plan change or resource provisioning is authorized by this design document.

## RyanAI implementation sequence

1. Verify Supabase Branching is available/enabled for the existing project and understand the actual cost before any activation.
2. Decide whether Supabase GitHub integration owns branch lifecycle or a GitHub Actions workflow does. Do not run both.
3. Add a PR workflow that waits for the branch, validates branch identity, applies Prisma/Supabase migrations in the correct order, and runs tests.
4. Add schema-diff evidence and close/merge cleanup with TTL.
5. Verify with a disposable test PR and prove that production database identifiers are never used.
6. Only then consider per-agent-task database branches. Agent task branches must be isolated from one another and inherit no production credentials.

## Important distinction from Lakebase

Lakebase's copy-on-write model makes data-bearing branches fast and storage-efficient. Supabase preview branches are separate environments and are data-less by default. Do not claim copy-on-write behavior or production-data cloning for RyanAI's Supabase setup. For current safety, schema parity plus synthetic seed fixtures is the default.
