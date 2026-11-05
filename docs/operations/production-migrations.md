# Production database migration procedure

RyanAI never applies Prisma schema changes during API startup. The API performs
read-only schema readiness checks. Committed migrations run in a dedicated,
one-shot Docker image through a protected GitHub workflow.

## Two independent approvals

1. Review the migration files included in the current `main` commit.
2. Confirm that the exact commit has completed the required CI/security checks
   and isolated provider verification.
3. Dispatch **Production database migrations** from `main` and select
   `APPLY`.
4. Approve the protected `production-migrations` GitHub environment when its
   reviewer gate is presented.
5. After migrations succeed, a production API deployment requires a separate
   dispatch of **Deploy API to Render** from the same `main` commit, selecting
   `DEPLOY`. The existing Render enable/approval switches and the protected
   `production` environment remain required.

Selecting `NO`, dispatching from a different branch, using a stale main
commit, missing protected connection configuration, or failing any preflight
check stops the migration workflow. A successful migration does not itself
trigger a deployment.

## Required GitHub environment configuration

A repository administrator must configure these settings directly in GitHub.
This PR does not create or modify secrets or environment settings:

- Create the `production-migrations` environment and require an independent
  reviewer approval before its job can access environment secrets.
- Add `PRODUCTION_DATABASE_URL` as an environment secret. It must contain the
  current Supabase PostgreSQL connection URL. Do not put it in repository
  files, logs, pull requests, or chat.
- Add `SUPABASE_SESSION_POOLER_HOST` as an environment variable using the
  exact Session Pooler hostname copied from the Supabase project's Connect
  panel. Do not infer or derive the pooler hostname.

The workflow uses the configured Supabase project URL and the bundled public
Supabase Root 2021 CA. The database URL, password, and pooler hostname are
never printed by the workflow.

## Migration execution

The workflow:

- Runs only through manual dispatch on `main`.
- Requires the explicit `APPLY` input.
- Verifies the exact main SHA, required CI/security checks, and provider
  verification before the protected migration job starts.
- Builds the root Dockerfile's `migrate` target.
- Requires the configured Session Pooler host and bundled CA, normalizes the
  database URL, and enforces `sslmode=verify-full` with Prisma's
  `sslaccept=strict`.
- Runs only committed Prisma migrations; it does not use `prisma db push`.

Render's free web services do not support `preDeployCommand`. The migration
workflow therefore runs separately from the Render API container and from API
startup.

## Deployment dependency

The **Deploy API to Render** workflow is also manual. It requires the explicit
`DEPLOY` input and a successful **Production database migrations** workflow
run for the same exact `main` SHA. It independently verifies current main,
CI/security, provider checks, Redis availability, Render configuration, and
the live API health endpoint. The `production` environment remains the
separate production deployment approval boundary.

A migration success for an older commit cannot authorize deployment of a
newer one. Run the migration workflow again for the current main commit.

## Safety boundaries

- No migration or schema DDL is run by API startup.
- No production database migration is run by this PR or by pull-request CI.
- No database credentials, Supabase secrets, Render settings, or paid plans
  are changed by this PR.
- The migration workflow fails closed when required protected environment
  configuration or approvals are unavailable.
