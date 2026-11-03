# RyanAI hybrid deployment architecture

**Status:** Accepted architecture target; migration not yet implemented  
**Decision date:** 2026-11-03  
**Source of truth:** `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`, `main`

## Decision

RyanAI will use one coordinated, commit-addressed release across two hosting platforms:

- **Render delivers the web frontend.** The Render static site builds the Vite application from the official repository.
- **Vercel executes the request/response backend.** API routes that are compatible with Vercel Functions will run as serverless functions.
- **Render may continue to host persistent supporting processes** (for example MCP HTTP services, queue consumers, scheduled workers, and other long-lived processes) where their lifecycle or protocol is not compatible with Vercel Functions.
- **GitHub remains the source of truth** for code, review, CI evidence, and release provenance.

This is a deliberate split by workload, not a requirement that every process be forced onto one platform.

## Why the migration must be staged

The current API is not a stateless serverless handler. The existing `src/server/launcher.ts` creates a Fastify server, registers WebSocket routes and Redis/PostgreSQL integrations, and starts scheduler, alert, task-worker, brain-monitor, attachment-scanner, and cleanup processes. A Vercel Function has a bounded invocation lifecycle and is not a persistent process host. Moving the launcher wholesale into a function would risk starting background work per invocation, breaking WebSockets or long-lived connections, and creating duplicate workers.

Therefore, the backend migration must first separate application construction from process startup and classify every route by runtime compatibility. Do not point production traffic at a partial adapter.

## Target topology

| Responsibility | Platform | Runtime |
|---|---|---|
| RyanAI web application | Render | Static site / CDN |
| Stateless HTTP API routes | Vercel | Node.js Functions |
| Persistent MCP service | Render | Persistent web service |
| Durable queue consumers and schedulers | Render | Background workers |
| PostgreSQL | Existing approved database provider | Managed database |
| Redis | Existing approved Redis service | Managed key-value |
| CI, reviews, release manifest | GitHub | Protected workflows |

PostgreSQL remains the durable source of truth. Redis remains transient coordination/cache/queue infrastructure with the agreed `noeviction` policy. Platform changes must not silently move or recreate either data store.

## One release identity

A release is identified by the same immutable Git commit SHA on both platforms. The release record must include:

- repository and commit SHA;
- application version/tag, when one is cut;
- Render frontend deployment identifier and resulting URL;
- Vercel backend deployment identifier and resulting URL;
- supporting Render service versions where applicable;
- CI/security check results for that exact SHA;
- smoke-test and frontend-to-backend integration results;
- operator approval and rollback references.

A successful build on one platform is not proof that the other platform deployed the same commit or is healthy. A release is considered coordinated only after both deployment records and cross-platform checks agree on the commit SHA.

## One visual identity and shared image assets

The frontend must use the canonical RyanAI brand assets stored in the official repository. Render and Vercel must not maintain separate hand-copied logos, favicons, or brand artwork. Both builds consume the same tracked asset paths from the same commit. Asset changes are reviewed as source changes and are included in the release SHA. No image is uploaded independently to a hosting dashboard as the canonical source.

## Routing and security contract

- The Render frontend receives one configured public API base URL for the Vercel backend.
- Vercel API routes validate authentication and authorization server-side; browser-visible variables contain public configuration only.
- CORS allows only the approved Render frontend origin(s) and explicitly approved local development origins.
- Secrets remain in the hosting platform's server-side secret stores. Never place provider, database, Redis, signing, or service-role secrets in Vite variables or committed files.
- Use least-privilege credentials and separate preview/staging/production scopes.
- Webhooks use signature verification and replay protection.
- Database access uses TLS and the existing approved network policy. Do not embed IP addresses in connection strings.
- Do not enable a deployment by setting a feature/enablement variable to `true` as part of this architecture PR. Deployment gates remain disabled unless separately reviewed and explicitly approved.

## CI and release policy

1. Pull requests and pushes run the required build, test, workflow-validation, dependency-review, and security checks without path-based skipping of required checks.
2. Required checks are not cancelled by newer runs.
3. Preview deployments may be used for validation only when the existing approval policy permits them.
4. Production deployment remains manual/approval-gated. No automatic production deployment, container publication, database migration, secret update, or plan upgrade is introduced by this decision.
5. Deployments must use the reviewed commit SHA, not a mutable branch head fetched later.
6. Failed or incomplete cross-platform verification blocks release promotion.
7. Rollback references must be recorded independently for Render and Vercel.

## Required implementation phases

### Phase 1 — Render frontend isolation

- Keep the Render static site as the frontend delivery target.
- Confirm its build command, publish directory, SPA fallback, public environment variables, and custom-domain behavior.
- Remove production dependence on a Render-hosted public API only after the Vercel API is verified.
- Keep Render API service configuration available during migration; do not delete or repurpose it prematurely.

### Phase 2 — Serverless API extraction

- Refactor Fastify route registration into a reusable application module with no listener or worker side effects on import.
- Create explicit Vercel Function entrypoints for compatible HTTP routes.
- Keep long-running workers, MCP, WebSocket/realtime features, schedulers, and attachment scanning on an appropriate persistent runtime until separately redesigned and tested.
- Define request body size, timeout, streaming, raw webhook body, and connection-pooling constraints per route.
- Add tests proving that importing a function does not start workers or open unmanaged listeners.

### Phase 3 — Shared contracts and integration

- Publish a route compatibility inventory and stable API contract.
- Configure the Render frontend API base URL to the Vercel API origin using public configuration only.
- Verify auth redirects, cookie domain/same-site behavior, CORS, CAPTCHA, uploads, webhooks, and realtime route fallbacks.
- Run end-to-end tests from the deployed Render frontend against the Vercel preview backend.

### Phase 4 — Coordinated release and cutover

- Add a release manifest tying both platform deployments to one commit SHA.
- Stage and test both platforms before switching the public API route.
- Require human approval for production cutover.
- Retain the previous Render API route and deployment for rollback until the new path has passed the agreed observation window.

## Acceptance criteria

- [ ] Render serves the frontend from the official repository and intended commit.
- [ ] Vercel serves the extracted, tested serverless API routes from that same commit.
- [ ] Persistent workers and unsupported protocols remain on a suitable persistent runtime.
- [ ] Browser bundles contain no server-side credentials.
- [ ] Authentication, CORS, webhook signatures, uploads, and API error handling pass integration tests.
- [ ] CI/security checks are green for the exact release SHA.
- [ ] Both deployment identifiers and health/smoke-test evidence are recorded together.
- [ ] Rollback is documented and tested.
- [ ] Production cutover has explicit human approval.

## Current-state note

At the time of this decision, the repository's `render.yaml` describes both a Render static frontend and a Render Docker API service, while `vercel.json` configures a Vite frontend build. The API launcher is a long-running Fastify process with background-service startup. These existing settings are intentionally not flipped in this documentation-only decision: changing the frontend API URL or removing the Render API before the Vercel function adapter exists would break the running application.

This document records the approved destination and the safe migration sequence. It does not claim that the hosting projects, environment variables, DNS, deployments, or production traffic have been changed.
