# Render runtime verification (staging)

This Blueprint is intentionally separate from `render.yaml`. It creates a
staging API and a dedicated staging Key Value instance; it does not modify,
reuse, or deploy the production services.

## Required isolation

1. Apply `render.staging.yaml` as a **new Blueprint/environment**, not as an
   update to the existing production Blueprint.
2. Set `DATABASE_URL` to a dedicated, empty/non-production PostgreSQL
   database. Never copy the production URL. The current workspace has no
   Render Postgres instance, so provision a separate staging database with
   your approved database provider before continuing.
3. Set `CORS_ORIGINS` to the exact staging frontend origin, or leave it empty
   for API-only checks.
4. Keep provider, messaging, and production credentials out of this staging
   service. Scheduled jobs, alerts, and attachment background jobs are off.
5. Apply the repository's reviewed migrations only to the isolated staging
   database. Do not run `db:push` or migrations against production as part of
   this verification.

## Acceptance checks

- Docker build completes and the image exports.
- Startup logs show a real PostgreSQL connection and schema inspection.
- Startup logs show Redis initialization and a successful `PONG`.
- `/livez` returns 200 after the API binds.
- `/readyz` and `/health` return 200 only when PostgreSQL, Redis,
  checkpointer schema, and API listener are all ready.
- Stop/restart the staging Redis instance and confirm readiness turns
  unhealthy and recovers after Redis returns.
- Confirm the staging API's Render service points to
  `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`.

The Blueprint sets auto-deploy off. Applying it does not authorize production
changes or a production release. Do not promote staging credentials or URLs
into production without a separate reviewed change.
