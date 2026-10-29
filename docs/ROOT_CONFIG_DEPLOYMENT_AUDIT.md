# Root Configuration and Deployment Audit

**Audit date:** 2026-10-28  
**Repository:** [RyanAI Autonomous Reasoning Platform](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat)

This audit checks the root-level Docker, environment, build, deployment, Kubernetes, security-tooling, and IDE files against the current package scripts and service topology. It distinguishes configuration fixes from platform settings that still require owner-supplied credentials or live deployment verification.

## Fixes applied in the configuration audit

| Area | Finding | Change |
| --- | --- | --- |
| Git hygiene | `.gitignore` ignored all Markdown files and re-ignored `.env.example` later in the file. | Removed the broad Markdown and `.env*` ignore rules while keeping `.env` and `.env.*` protected and explicitly allowing `.env.example`. |
| Environment | No canonical root `.env.example` existed, and the frontend template mixed local and container connection examples. | Added a safe canonical template; clarified that Compose overrides container connection URLs and that deployed static frontends need a separate HTTPS API origin. |
| Browser credentials | Provider keys were permitted under `VITE_*` names and the model helper attempted to read them in browser code. | Removed provider-key fields from the root env helper, made provider credentials server-only in the model helper, and added a Vite build guard plus regression tests for common provider key names. |
| CORS | The main Fastify launcher reflected arbitrary origins while enabling credentialed CORS. | Changed it to use the comma-separated `CORS_ORIGINS` allowlist; production defaults to no cross-origin access when no origins are configured. |
| Kubernetes PostgreSQL | The manifests set `shared_preload_libraries=vector`, but pgvector is a PostgreSQL extension, not a preload library. | Removed the invalid setting; enable the extension through the existing SQL/migration setup. |
| Kubernetes Redis | One manifest passed `$(REDIS_PASSWORD)` directly as an argument, so no shell expanded the secret. | Run Redis through `sh -c` and quote the environment variable at runtime. Updated both root and `k8s/` copies. |
| Kubernetes image references | Manifest image paths used `rmnganyane-dev`, while the publishing workflow derives the GHCR namespace from `RyanAI-Automated`. | Aligned API and web image references with the publishing workflow's lowercase repository path. |
| Render | The static frontend did not set its API origin; API DB/cache URLs were undocumented; a fixed `PORT` could override the hosting platform's assigned port. | Configured the frontend API origin, API CORS origin, generated JWT secret, and explicit required external `DATABASE_URL`/`REDIS_URL` settings; let Render assign `PORT`. |
| pnpm metadata | `pnpm-workspace.yaml` had no workspace package list and blocked build scripts needed by Prisma/esbuild if pnpm was used. | Declared `mcp-server` and `workflows-ryanai` workspace packages and allowed only the required build scripts. npm remains the root project's declared package manager. |
| IDE metadata | Root IntelliJ XML files referred to a different Java sample project and a local Windows path. | Removed stale tracked IDE workspace metadata and moved the MCP discovery setting into `.vscode/settings.json`. |
| CodeRabbit | The remote configuration referenced a `shared-configs` repository that could not be found under the organization. | Removed the unavailable remote configuration reference; local review settings remain. |
| Status claims | Completion files claimed full production readiness without commit-specific evidence; the production configuration listed planning targets as if they were active settings. | Replaced the certificate with a status notice, made the status file a release-gate checklist, and marked `PRODUCTION_CONFIG.js` as reference-only. |
| Python requirements | `requirements.txt` claimed there were no Python dependencies despite optional OpenAI/LangGraph/MongoDB examples. | Documented the optional packages and clarified that they are not required for the main TypeScript web/API stack. |

## Root-level file review

- **Docker:** `Dockerfile`, `Dockerfile.api`, `docker-compose.yml`, `.dockerignore`, `docker-entrypoint.sh`, `nginx.conf`, and `nginx.conf.template` were reviewed for build inputs, runtime ports, service names, health probes, proxy behavior, and secret handling. The API and web image targets remain distinct; Compose binds local service ports to loopback.
- **Node/npm:** `package.json`, `package-lock.json`, `.npmrc`, and `pnpm-workspace.yaml` were compared. npm is canonical; the root install intentionally uses legacy peer dependency resolution to match the lockfile.
- **Vercel/Vite:** `vercel.json` builds the web target into `dist`; `vite.config.ts` requires a separate HTTPS API origin for Vercel production builds and now rejects known provider secrets under browser-exposed `VITE_*` names.
- **Render:** `render.yaml` now wires the static site's API origin and CORS origin. The API still requires real external database and Redis URLs supplied through Render's environment settings.
- **Kubernetes/Kustomize:** `kustomization.yaml`, `database-infra.yaml`, `ryanai-databases.yaml`, `ryanai-apps.yaml`, and their `k8s/` copies were reviewed. Root and nested copies were updated together where duplicated. The included `hostPath` persistent volumes are for local/development clusters only; production should use the cluster's supported persistent storage class.
- **Environment/security:** `env.frontend.example`, `.env.example`, `import.meta.env`, and the server environment wiring were reviewed. Supabase publishable/anon keys are public by design; service-role keys and AI provider keys must remain server-side.
- **TypeScript/UI tooling:** `tsconfig.json`, `tsconfig.app.json`, `tsconfig.base.json`, `tsconfig.mcp.json`, `tsconfig.node.json`, `tsconfig.server.json`, `eslint.config.js`, `tailwind.config.js`, and `components.json` were checked for the current React/Vite and server split.
- **Security tooling:** `code-security.datadog.yaml`, `.coderabbit.yaml`, and `SECURITY.md` were reviewed for local configuration and supported paths.
- **IDE metadata:** `settings.json` was moved into `.vscode/settings.json`; stale root IntelliJ files (`compiler.xml`, `encodings.xml`, `jarRepositories.xml`, `misc.xml`, `modules.xml`, `vcs.xml`, `workspace.xml`) were removed because they described a different project or a local workstation.
- **Operational/status files:** `PRODUCTION_CONFIG.js`, `.completion-status.txt`, `COMPLETION_CERTIFICATE.txt`, and `requirements.txt` were corrected so reference targets and optional tools are not presented as verified live capabilities.

## Items that still require deployment-owner action

1. **Render:** set valid managed PostgreSQL and Redis URLs in the Render service settings. The blueprint intentionally uses `sync: false` for these secrets; it does not provision database/cache services itself.
2. **Vercel:** production deployment remains conditional on the repository's deployment flag and Vercel credentials. A successful workspace validation or preview does not mean production deployed. On 2026-10-28, Vercel explicitly rejected a deployment with `api-deployments-free-per-day` (`Resource is limited - try again in 24 hours`, more than 100 deployments/day). This is an account/project deployment quota, not a source-code build error. Pause unnecessary redeploys until the quota resets or the project owner upgrades/changes the Vercel plan; then deploy the intended commit and inspect its result. Do not attempt to bypass the platform limit.
3. **Kubernetes:** replace the local `hostPath` storage with an approved production StorageClass/PVC strategy before production use; ensure the GHCR packages are pullable by the target cluster.
4. **CORS/custom domains:** if Render service names or custom domains change, update `VITE_API_BASE_URL` and `CORS_ORIGINS` together.
5. **Provider calls:** configure provider credentials only as server-side secrets and test actual provider requests in staging. Health endpoints alone do not prove model availability or billing/quota access.
6. **Smoke-test secrets:** configure `PROD_GATEWAY_URL`, `PROD_FRONTEND_URL`, `PREVIEW_GATEWAY_URL`, and `PREVIEW_FRONTEND_URL` as GitHub Actions secrets before running `.github/workflows/smoke-test.yml`. Each value must be the real HTTPS endpoint for that environment; the API values must resolve to a health endpoint returning a successful HTTP status.
7. **Release validation:** check all required CI, integration, security and image-publish runs for the exact commit SHA. The config changes alone do not certify production readiness.

## Validation evidence

The changes add a Vite regression test covering seven prohibited `VITE_*` provider credential names. GitHub Actions are the authoritative test runner for the repository; use the current [Actions page](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/actions) to verify final results. This document does not claim that all workflows or live deployments have passed.
