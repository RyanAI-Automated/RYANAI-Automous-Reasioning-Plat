# RyanAI deployment and governance reconciliation plan

**Prepared:** 2026-11-04  
**Scope:** Read-only inventory and proposed changes. This document does not authorize or perform a Render Blueprint sync, service resume, resource creation, deploy, database migration, secret update, or GitHub ruleset mutation.

## 1. Canonical target

- Repository: `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`
- Branch: `main`
- Intended Render topology from `render.yaml`:
  - Static frontend built from repository root with `npm run build:web`, published from `dist`.
  - API service built with `Dockerfile.api`, health check `/health`.
  - Internal Virginia Key Value service `ryanai-redis-virginia`, eviction policy `noeviction`.
- Database: Supabase is the configured database target in the checked-in Blueprint. No Render Postgres instance was present in the read-only inventory.

## 2. Render inventory observed (2026-11-04)

All resources below were read only. No service was resumed, changed, deployed, or provisioned.

| Resource | Observed configuration | Reconciliation finding |
|---|---|---|
| `ryanai-api` (`srv-dbk4giu7bikc7394a4r0`) | Docker, `Dockerfile.api`, `/health`, Oregon, free, auto-deploy off, suspended by user; source URL points to `rmnganyane-dev/RYANAI-Automous-Reasioning-Plat` | Dockerfile and health path are aligned, but repository differs from the canonical organization repo and service is intentionally suspended. Keep suspended until source/credentials/DB readiness are verified and approval is given. |
| `ryanai-web` (`srv-dbk4giu7bikc7394a4s0`) | Static site, root directory `src/`, build command `npm ci --legacy-peer-deps && npm run build`, `./dist`, source URL points to `rmnganyane-dev/RYANAI-Automous-Reasioning-Plat`, auto-deploy on checks pass, suspended by user | Does not match the checked-in Blueprint's repository-root build contract (`npm ci --legacy-peer-deps && npm run build:web`). Confirm the actual root-level package/build output before changing it. Keep suspended. |
| `RYANAI-Automous-Reasioning-Plat` (`srv-dafvs4ht0dsc7380mapg`) | Docker, canonical organization repo, Virginia, free, `Dockerfile`, docker command `./`, blank health path, auto-deploy off, currently not suspended | Root Dockerfile's final stage is the Nginx web image, not the dedicated API image. This service is therefore not a verified API deployment. Do not deploy or repurpose until ownership and intended role are confirmed. |
| `ryanai-redis` (`red-dbk4miff3r2c738mecpg`) | Oregon, free, suspended, persistence off, `volatile_ttl`, IP allowlist restricted to one client IP | Mismatches Blueprint's Virginia, `noeviction`, internal-only Key Value target `ryanai-redis-virginia`. Do not resume or create a replacement without approval; first confirm whether any state must be preserved. |
| Render Postgres | No instances returned | Blueprint uses Supabase; no Render Postgres provisioning is proposed. |

The API service's recent deploy history included multiple `update_failed` attempts. The older canonical-repo service also has historical failed deployments. These failures need log-level diagnosis before any deployment attempt.

## 3. Safe reconciliation order (approval gates retained)

1. Confirm the canonical GitHub repository and desired service ownership. The two newer suspended services currently point to a different repository URL.
2. Confirm the Supabase connection target and verify database migration compatibility using the disposable CI upgrade test. Never apply the migration audit's output automatically.
3. Inspect Render build/deploy logs for the failed API attempts and identify whether failure is build, startup, health, or missing environment configuration. Do not expose environment values in logs or reports.
4. Prepare a change-only Render plan:
   - Frontend: canonical repository, root directory `.`, root `build:web` command, `dist` publish directory.
   - API: canonical repository, root directory `.`, `Dockerfile.api`, `/health`, explicit no-auto-deploy until release approval.
   - Redis: only if still required, confirm Virginia/internal connectivity, `noeviction`, persistence policy and data-loss implications before creating or moving anything.
5. Present exact service IDs, old/new fields, cost implications, and rollback plan for explicit approval.
6. Only after approval: apply the minimum required changes, validate health and authenticated provider probes, then consider deployment separately.

## 4. GitHub governance state and prepared repair

Read-only ruleset inspection returned:

- Ruleset ID: `26360956`
- Name: `main-protectiona`
- Enforcement: active
- Rules: empty
- Bypass: one integration actor with `always`
- Ref include list also contains `~ALL`, in addition to the default branch and `refs/heads/main`.

The repository already contains `.github/workflows/enforce-main-protection.yml`. It is a manual `workflow_dispatch` workflow that requires the exact confirmation string `ENFORCE-MAIN-PROTECTION` and the pre-existing `GH_ADMIN_TOKEN` secret. It proposes one required review, stale-review dismissal, review-thread resolution, ten CI/security status contexts, non-fast-forward protection, deletion protection, and Copilot review. Its verification now also checks that the Copilot review rule and the explicit main ref are present.

**Not executed:** The workflow was not dispatched, no secret was read, and the live ruleset was not modified. Before execution, confirm that the administrator credential has repository Ruleset Administration write access and that the listed check contexts are still the intended merge gate.

## 5. Provider verification gate

The provider-verification workflow on the current main commit was still pending at the time of this inventory. No successful NVIDIA, Qwen, and Logic verification is claimed here. Earlier HTTP 401 responses indicate credential/configuration failure; do not place provider keys in source control, issue comments, or chat. Update provider secrets only through the provider's authorized secret manager, then rerun the isolated verification workflow.

## 6. Explicitly unchanged

- No Render service settings or environment variables changed.
- No service resumed, deploy triggered, Blueprint synchronized, or resource provisioned.
- No Render or GitHub secret values read or changed.
- No production database migration or DDL executed.
- No GitHub ruleset mutation or governance workflow dispatch performed.
