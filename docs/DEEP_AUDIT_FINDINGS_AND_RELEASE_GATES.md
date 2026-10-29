# RyanAI Deep Audit Findings and Release Gates

**Audit date:** 2026-10-29  
**Repository:** `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`  
**Scope:** Structural review plus targeted inspection of the primary Fastify launcher, alternate server entry points, reasoning clients, agent tools, Jarvis bridge, GitHub Actions and Vercel deployment evidence.

> This is a targeted audit snapshot, not a declaration that every page, API handler, agent module, and integration has received a file-by-file review. Findings are labelled by the evidence actually inspected. A search that did not find a reference is not proof that a feature is absent.

## Confirmed fixes

| Area | Evidence / issue | Change |
|---|---|---|
| Alternate CLI CORS | `src/server/index.ts` previously added wildcard `Access-Control-Allow-Origin: *` on authenticated API routes. | PR #374 replaced the hook with the explicit `CORS_ORIGINS` allowlist and added a regression guard. Merged to main. |
| Legacy MCP action API | `src/server/launcher.ts` returned `success: true` and echoed an action/payload without dispatching a tool. | PR #375 now returns `501 Not Implemented` for non-empty requests and adds a regression test. Merged to main. Use the dedicated Streamable HTTP MCP service at `/mcp`; migration of any old callers remains a separate task. |
| Legacy patch server | `src/server/routes/patchRoutes.ts` lacked a route-level admin guard; `src/server/routes/server.ts` imported the sibling patch route from the wrong path. | PR #376 adds `requireAdmin`, repairs the import, and adds authorization/health tests. Merged to main. |
| Reasoning error handling | Primary JSON/SSE handlers and the alternate reasoning plugin returned raw exception messages to clients. | PR #377 logs the exception server-side and returns a stable generic 502 response; JSON/SSE redaction tests added. Merged to main. |
| Streaming API client | `src/services/apiClient.ts` called `/api/reasoning`, while the primary launcher registers `/api/reasoning/stream`. | PR #378 updates the client to use `API_ROUTES.streamPath` and adjusts the test. Review its CI status before relying on the change. |

## Deployment findings

- The Vercel production build failed in `vite.config.ts` with: `Set VITE_API_BASE_URL to the HTTPS origin of your separate API deployment`.
- The repository's Render blueprint documents `https://ryanai-api.onrender.com` as the API origin. A Vercel `VITE_API_BASE_URL` variable was added for production and preview using that documented origin.
- The failed deployments were already in progress when the environment variable was created. A later production deployment for main commit `82d29e4dca0fdc4e17ed2976eb70b5c68545b262` was observed in `BUILDING` state; the build and live API still require confirmation.
- The API host's live health endpoint was not verified from the audit execution environment. Do not assume the Render API is healthy simply because the URL is present in configuration.
- Do not launch repeated production deployments to test the change. Inspect the current build first and respect Vercel's daily deployment quota.

## High-priority remaining checks

### P0 — release safety

1. **Verify the current Vercel build and API target.** Confirm the build reaches `READY`, the production alias points at that deployment, the frontend loads, and the configured API `/health` responds successfully. Then run an authenticated reasoning round trip with a valid provider configuration.
2. **Protect `main`.** The repository branch API reported `protected: false` and no required status checks. Configure branch protection/rulesets to require the core CI, integration, security, and deployment-validation checks before merge.
3. **Review Vercel environment hygiene.** The project has multiple legacy Neon/Postgres variables; Vercel metadata flags several connection variables with `readable-secret` security issues. Review visibility, remove unused duplicates, and rotate credentials if there is evidence they were exposed. No secret values are recorded in this audit.
4. **Run real integration checks.** The latest CI has successful validation and container/security jobs on earlier commits, but a passing preview build is not proof that the deployed API, model provider, authentication, or Jarvis remote endpoint works live.

### P1 — API, agent, and integration behavior

1. Finish a route-by-route audit of `src/server/launcher.ts`, `src/server/routes/*`, `src/api/*`, and any alternate entry points. Verify authentication policy, request schema validation, error contracts, route registration, and whether each route is actually used.
2. Trace every active agent tool from `src/agent/engine.ts` to its handler and tests. Confirm tool authorization, user scoping, approval gates, timeout behavior, and side effects.
3. Verify Jarvis staging end-to-end: status, authenticated patch submission, stack-manifest publication, ingress authentication, safe workspace path handling, and rejection of unsafe patches. Unit/fixture tests alone do not prove the real remote is configured or reachable.
4. Verify the MCP manager's HTTP host/origin checks, token configuration, protocol round-trip, tool dispatch, and lifecycle. Do not reintroduce a success-shaped response that only echoes input.
5. Verify every frontend page and navigation route, including loading, empty, error, unauthorized, and stale-health states. Confirm UI status is sourced from live APIs rather than placeholder values.

### P2 — legacy modules and operational quality

1. `src/tools/fileShellTools.ts` contains a hard-coded Windows workspace path and a shell command tool that invokes commands without sandbox isolation. The repository search found no import into the active reasoning engine; treat it as an unverified legacy/orphan module. Before reuse, remove it or replace it with the admin-gated, root-configured workspace tools and a real sandbox/command allowlist.
2. `src/api/reasoningRoute.ts` contains a simulated reasoning response and SSE progress loop. Repository search found its registration function but no active caller. Confirm its reachability/ownership; remove it or clearly deprecate it if no supported entry point uses it.
3. `.github/workflows/google.yml` still contains sample project/cluster/region values marked TODO. Keep it disabled until real deployment identifiers, secrets, and target infrastructure are configured and validated.
4. Datadog Synthetic checks were skipped in the observed runs. Configure the required synthetic test credentials/endpoints or clearly mark that live monitoring is not enabled.
5. The Vercel build logs include an npm `cache-dir` configuration warning and deprecated transitive packages. Clean up the npm config warning and schedule dependency maintenance after the release blocker is resolved.

## Release acceptance checklist

- [ ] Current `main` commit SHA recorded and all required GitHub Actions checks green.
- [ ] Production Vercel deployment `READY`; production alias and commit SHA verified.
- [ ] Frontend and API health endpoints verified over HTTPS.
- [ ] Authenticated reasoning JSON and SSE round trips succeed with a real configured provider.
- [ ] Unauthenticated and non-admin access tests pass for protected routes.
- [ ] Jarvis staging and MCP round trips verified against actual configured services.
- [ ] Container build and security scans pass for the exact release commit.
- [ ] Database migration/backup and rollback procedures reviewed.
- [ ] Required secrets are server-side only; no secrets in client bundles, logs, or build output.
- [ ] Remaining unreviewed modules and deferred features explicitly recorded before beta sign-off.

## Status language

Use **implemented** only when the path is traced to working code; **tested** only when a relevant test has run and passed; **live verified** only when the deployed endpoint or external integration has been exercised. Keep **not inspected** and **not verified** separate from **missing**.
