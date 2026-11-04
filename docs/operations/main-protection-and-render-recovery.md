# Main-branch protection and Render recovery evidence

Last authenticated infrastructure inspection: **2026-11-04**.

This document records observed repository and Render state. It is not authorization to change production configuration, provision resources, sync a Blueprint, deploy, or rotate secrets.

## Main-branch governance

The existing ruleset was read again after PR #830 merged. It remains ID `26360956`, named `main-protectiona`, with enforcement active, an empty `rules` array, and one integration bypass actor (`actor_id: 1144995`, `bypass_mode: always`). An active ruleset with an empty rules array is not merge protection.

PR [#830](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/830) merged at 2026-11-04 12:43:38Z as commit `f6384eac380800bc08df31faa91f6da304337786`. Its change updates the manual enforcement workflow; it does **not** itself apply the ruleset. The live read after the merge confirms the name, empty rules array, and bypass actor are unchanged.

The PR head had 56 check runs at inspection: 25 success, 28 neutral, 2 skipped, 1 queued, and zero failures. The queued `record-merged-pr` check meant the run set was not fully settled at that snapshot. Do not describe the ruleset as repaired or main as protected. The enforcement workflow remains a manual operation requiring `GH_ADMIN_TOKEN` with repository Administration write permission.

The connected GitHub integration can write repository content and pull requests but does not have Administration write permission. The ruleset workflow therefore still requires an authorized administrative credential. Do not attempt to bypass this permission boundary.

## Render live-state inspection

The confirmed Render workspace was `SirG's workspace`. The following resources were read through the authenticated Render connector; no mutation was made.

### Official API service

- Service: `RYANAI-Automous-Reasioning-Plat` (`srv-dafvs4ht0dsc7380mapg`)
- Repository: `https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`
- Branch: `main`
- Region: Virginia
- State: not suspended
- Auto-deploy: off
- Live Dockerfile: `./Dockerfile`
- Live health-check path: empty

The source repository and branch are correct, but the live Dockerfile and health-check path do not yet match the approved API contract.

### Separate suspended API service

A second service named `ryanai-api` (`srv-dbk4giu7bikc7394a4r0`) is suspended, points to the personal fork `rmnganyane-dev/RYANAI-Automous-Reasioning-Plat`, and is in Oregon. It uses `Dockerfile.api` and `/health`. It is not the official API service and must not be mistaken for it.

### Redis / Key Value

The only Key Value instance returned by the workspace listing is:

- Name: `ryanai-redis` (`red-dbk4miff3r2c738mecpg`)
- Region: Oregon
- State: suspended
- Persistence: off
- Eviction policy: `volatile_ttl`
- Plan: free

No Virginia Key Value instance named `ryanai-redis-virginia` was returned. No Render Postgres instances were returned.

The checked-in `render.yaml` describes the intended API contract (`Dockerfile.api`, `/health`) and references a Virginia Key Value resource named `ryanai-redis-virginia` with `noeviction`. That resource is not present in the live account listing. Applying the Blueprint without reconciling this mismatch could provision a new resource. **Do not sync the Blueprint or create a replacement Redis instance without explicit approval.**

## Deployment workflow safeguards

The current `.github/workflows/deploy-render.yml` is gated on all of the following:

- A successful `CI - Build, Test, and Integrate` push run on `main`.
- The workflow run SHA matching the current `main` SHA.
- `RENDER_DEPLOY_ENABLED=true` and `RENDER_DEPLOY_APPROVED=true`.
- The required CI/security checks succeeding on the exact SHA.
- An authorized `RENDER_API_KEY`.
- The expected Virginia Redis resource being available before the API service is updated or deployed.

The workflow updates only the existing official API service ID after its Redis precondition passes. It does not create Redis. Keep deployment disabled until the live Redis/API mismatch is resolved and a separate deployment approval is given.

## Provider verification evidence

On main SHA `6b77f4f1c813b2e380afb5f1b548fbc8b4a9b3b3`, provider workflow run `41827207125` produced:

- NVIDIA primary: authenticated challenge passed.
- Qwen secondary: provider returned HTTP 401.
- Logic: provider returned HTTP 401.
- Both failed-provider jobs persisted their degraded health record and read it back successfully.

The two failures are genuine provider authorization failures. Do not mark these providers healthy, weaken the live probe, or replace it with a mock. Credentials were not accessed or changed.

## Required recovery sequence

1. Complete PR #830 checks and obtain the required administrative capability before attempting ruleset enforcement.
2. Resolve the Redis region/state/persistence conflict without creating or upgrading resources until explicitly approved.
3. Align the existing official Render API service to `Dockerfile.api` and `/health` only after the Redis precondition is satisfied.
4. Run authenticated Redis connectivity, API readiness, and durable-queue recovery checks against the approved runtime.
5. Obtain separate explicit approval before enabling or triggering any production deployment.

## Safety record

The 2026-11-04 inspection did not deploy, restart, resume, suspend, reconfigure, or provision Render resources; did not sync a Blueprint; did not modify secrets; did not change production databases; and did not upgrade a plan.
