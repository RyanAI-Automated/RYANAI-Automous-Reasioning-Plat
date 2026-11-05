# RyanAI Render-primary deployment and Railway backup plan

**Prepared:** 2026-11-05  
**Status:** Proposed plan only — review required  
**Scope:** Render is the primary application host. Railway is a secondary platform for a separately validated API/Docker workload recovery path. This document does not change cloud resources, deploy services, run migrations, change secrets, alter DNS, enable failover, or approve paid plans.

## 1. Governing topology

| Workload | Primary | Secondary | Release rule |
|---|---|---|---|
| Web frontend | Render Static Site | No automatic Railway web promotion in this phase | Deploy only through an approved Render release |
| Main API | Render Docker Web Service | Railway Docker API workload | Keep Railway warm/ready only after separate validation; no automatic traffic switch |
| MCP HTTP API | Dedicated Render Web Service (target; not yet present in the inspected Render service inventory) | Railway Docker workload after parity validation | Independent service identity, health probes, logs and release evidence |
| PostgreSQL / persistent state | Existing authoritative database service and schema | Shared authoritative database endpoint only where network/security policy permits; no independent writable fork | No production migration without separate explicit approval |
| Redis / queue transport | Render-connected Redis resource after reconciliation | Railway-side transport only if its role and state semantics are proven | Do not assume Redis replication or cross-host queue consistency |

Render remains the primary source of application hosting. Railway is a backup platform, not an automatic replacement or failover target. Vercel is not part of this architecture.

## 2. Read-only Render inventory observed on 2026-11-05

Workspace: `SirG's workspace` (`tea-d5ogqtcoud1c73b266f0`).

| Render service | Observed facts | Plan finding |
|---|---|---|
| `ryanai-web` (`srv-dbk4giu7bikc7394a4s0`) | Static Site, repository-root build `npm ci --legacy-peer-deps && npm run build:web`, publish `./dist`, branch `main`, auto-deploy on commit, free plan, not suspended | Existing primary web service. Its live auto-deploy setting means a merge to `main` can trigger a deployment; do not merge deployment-affecting work until the release control is explicitly reviewed. |
| `ryanai-api` (`srv-dbk4giu7bikc7394a4r0`) | Docker Web Service, `Dockerfile.api`, `/health`, Oregon, free plan, branch `main`, auto-deploy on commit, not suspended | Existing primary API service. The user reports API instability; this inventory is configuration evidence, not proof of runtime health. |
| `RYANAI-Automous-Reasioning-Plat` (`srv-dafvs4ht0dsc7380mapg`) | Older Docker service, Virginia, root `Dockerfile`, no health-check path, auto-deploy off | Legacy service; do not repurpose or treat it as the API without a separate ownership and image-role review. |
| Dedicated MCP HTTP service | No dedicated MCP service appeared in the inspected Render workspace service list | Missing from live Render inventory. Do not claim MCP is deployed on Render. |

The checked-in `render.yaml` describes the Web and API services plus a Key Value resource. It does not yet describe a dedicated MCP HTTP service. Its Redis resource declaration must not be blindly synced: reconcile the live Redis resource identity, region, persistence and policy first. A Blueprint sync could create or modify resources and therefore remains separately approval-gated.

## 3. API and MCP health must remain independent

### Main API

The API already exposes:
- `GET /livez`: process liveness.
- `GET /readyz`: dependency readiness.
- `GET /health`: readiness-compatible Render health path.

The readiness payload checks PostgreSQL, Redis, agent checkpointer initialization, API listener and the agent queue listener. A passing container build or a live process alone is not API readiness.

### MCP HTTP API

The MCP HTTP server is implemented in `mcp-server/http.js`:
- `GET /health` currently returns a simple process response (`status: ok`); it is not an independent dependency-readiness report.
- `POST /mcp` serves Streamable HTTP MCP requests.
- Its current defaults bind to loopback (`127.0.0.1`) and port `8765`; a Render service needs an explicit externally reachable bind and correct platform-port mapping.
- Non-loopback binding requires an `MCP_AUTH_TOKEN` of at least 32 characters. Host/origin allowlists must be explicitly configured for the deployed hostname.

Before creating the Render MCP service, implement and test a deployment-safe listener contract (bind address and Render `PORT` handling), separate `/livez` and `/readyz` semantics, authenticated MCP request checks, and safe shutdown. Do not simply expose the current loopback defaults.

### Independent verification matrix

| Probe | API service | MCP service | Required evidence |
|---|---|---|---|
| Liveness | `/livez` | `/livez` (to be added) | HTTP response, service identity, timestamp |
| Readiness | `/readyz` | `/readyz` (to be added) | Service-specific dependency checks; no inference from the other service |
| Render health path | `/health` | Dedicated MCP health path after implementation | Render deploy event and health-check result |
| Runtime | PostgreSQL, Redis, checkpointer, worker listener | MCP HTTP listener, tool registry/bootstrap and required backend reachability | Sanitized logs and exact deployed commit |
| Security | API auth and owner-scoped authorization | MCP bearer auth, host/origin allowlists and tool authorization | Negative tests and no secret values in logs |

Do not combine the two services into one aggregate green indicator. The dashboard must show API and MCP as separate states, including unknown, degraded and unavailable.

## 4. Railway backup readiness gates

Railway is a secondary Docker/API workload platform. It is not a traffic failover system until all of these gates pass:

1. A separately reviewed Railway service definition builds the same pinned repository commit and compatible API/MCP artifacts.
2. Runtime configuration uses the same approved authentication identity model and authoritative database/schema; secrets are injected independently through the approved secret manager and never copied into Git.
3. Database access, migrations, audit records, execution receipts and idempotency semantics are consistent across both environments.
4. Queue ownership and worker leases prevent duplicate execution if both platforms are running. No two active workers may process the same delegation without a proven lease/claim protocol.
5. API and MCP health/readiness probes are independent on Railway as well as Render.
6. Backup restore, restart, interruption, replay, and recovery tests pass using synthetic/non-production workloads.
7. Traffic switching, DNS, rollback and operator runbooks are rehearsed without production traffic.
8. Human approval is obtained before enabling any production failover or changing traffic routing.

Until every gate is evidenced and approved, Railway is standby capacity only. Do not configure automatic failover.

## 5. Shared identity, data and evidence contract

- Preserve one owner identity and consistent authentication/authorization decisions across hosts.
- Keep PostgreSQL as the authoritative durable store for PA delegations, agent runs, audit events and execution receipts.
- Do not create competing writable databases or silently fork user memory.
- Carry stable delegation IDs, run IDs, trace IDs, idempotency keys and execution receipts across host boundaries.
- Make retries and recovery idempotent; a lost HTTP response must not create a second delegation or duplicate execution.
- Record the actual execution host and commit in audit/evidence records.
- Privileged actions remain blocked until explicit human approval; neither PA nor Jarvis can self-authorize.

## 6. Release and change-control gates

- PR branches and review builds must not deploy production services.
- Current Render Web and API services are configured for auto-deploy from `main`. This is a material release-control risk: merging to `main` can cause a Render deploy even when no manual trigger is used. Review and obtain approval for any auto-deploy setting change separately; this PR does not change it.
- No production deploy, Blueprint sync, service mutation, resource creation, database migration, secret creation/change/rotation, DNS change, paid upgrade, or Railway failover is authorized by this plan.
- Keep migrations in a separately reviewed and explicitly approved workflow; never run them as part of API startup.
- Do not weaken TLS verification or use `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- Preserve human review, required CI/security checks, and no auto-merge.

## 7. Ordered execution plan

1. **Stabilize Render API:** inspect current deploy/runtime logs; independently verify PostgreSQL connectivity, Redis, checkpointer schema, worker listener, `/livez`, `/readyz` and `/health`. Record exact commit and timestamps. No blind credential edits or production migration.
2. **Complete PA-1 lifecycle:** finish idempotent delegation creation/reconciliation, durable worker dispatch, human approval enforcement, reciprocal Jarvis proof verification, owner-scoped receipt retrieval, and interruption/retry/recovery tests. Record auditable receipts.
3. **Prepare MCP for Render:** implement the listener/port contract and independent readiness semantics; validate locally/CI with synthetic fixtures; then prepare a dedicated Render service definition for review. No service creation in this plan.
4. **Validate Railway backup:** verify build/runtime parity, shared identity/data/evidence contract, queue exclusivity, restore and recovery. Keep failover disabled.
5. **Release review:** present exact commit SHAs, CI/security results, service-level health evidence, proposed provider changes, costs (if any), rollback and operator approval before any production action.

## 8. Current status and evidence gaps

- Render Web and API service configurations were retrieved read-only on 2026-11-05.
- The live service inventory did not include a dedicated MCP HTTP service.
- This document does not claim that the API or MCP service passed a live health probe.
- No runtime log analysis, database query, migration, deployment, Blueprint sync, secret operation, resource creation, or failover was performed for this plan.
- This is a documentation-only proposal for human review, not a production release or PA-1 acceptance.
