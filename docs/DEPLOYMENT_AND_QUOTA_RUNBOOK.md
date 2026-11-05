# Render and Railway deployment runbook

## Deployment defaults

- **Render** is the default frontend and web/API delivery provider.
- **Railway** is the default Docker and persistent-workload provider.
- The official source repository is `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`.
- Vercel is not a supported deployment target or project integration.

## Render

The repository Blueprint defines `ryanai-web` (static Vite frontend), `ryanai-api` (Docker API using `Dockerfile.api`), and `ryanai-redis` (private Oregon key-value service).

Before enabling any Render deployment:
1. Verify the service is connected to the official repository and intended branch.
2. Keep pull-request previews isolated from production services.
3. Verify the static build publishes `dist` and points `VITE_API_BASE_URL` at the approved HTTPS API origin.
4. Verify the API Dockerfile, `/health` route, database pooler hostname, Redis connectivity, and system CA trust.
5. Keep automatic deployment disabled until exact-head CI/security checks and staging smoke tests pass.
6. Do not apply a Blueprint diff that creates or modifies production resources without separate approval.

The production Render workflow is manual, requires the explicit `DEPLOY` confirmation, exact-main CI/security evidence, configured approval gates, and a healthy Redis dependency. A workflow definition is not proof of a successful deployment.

## Railway

Railway is the default target for Docker services and persistent workloads. Use a dedicated RyanAI staging project/environment first; never repurpose an unrelated project or production environment as staging.

Before Railway can deploy:
1. Confirm the Railway account identity is `ganyane.ntsiyeni@gmail.com`.
2. Create or verify a dedicated staging project/environment linked to the official repository.
3. Configure the API service to build from `Dockerfile.api` and use `/health`.
4. Keep staging data, variables, storage, and networking isolated from production.
5. Run exact-commit CI/security checks and staging health/smoke tests.
6. Keep production deploy disabled until separately approved.

The Railway production workflow is manual-only. It requires `DEPLOY`, exact current-main identity, all named CI/security checks completed successfully, the `RAILWAY_DEPLOY_ENABLED` and `RAILWAY_DEPLOY_APPROVED` gates, and the protected GitHub production environment. Queued, skipped, cancelled, missing, or failed checks are not passes.

## Approval and safety

- No production deployment without explicit approval.
- No production database migration without separate approval.
- No secret creation, modification, rotation, or disclosure in a repair PR.
- No paid plan changes.
- No auto-merge or bypass of human review.
- Staging/preview deployment is allowed only when the target is demonstrably isolated and the exact commit is approved for that staging test.
- Verify the exact deployed SHA and runtime health independently after each approved deployment.
