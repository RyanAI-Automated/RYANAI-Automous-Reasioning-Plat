# RyanAI hybrid runtime, route, and dependency inventory

**Status:** Audited from source; implementation and production migration are not authorised by this document  
**Audit date:** 2026-11-03  
**Audited repository:** `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`  
**Audited base commit:** `a1067a215c53c5d714cfdadff09337d011351a86`  
**Architecture decision:** Render delivers the web frontend; Vercel hosts only compatible stateless HTTP API handlers; Railway is the proposed persistent Docker runtime for selected existing RyanAI images and workloads. This is a target architecture, not a claim that Railway is configured or deployed.

This inventory is an evidence-based migration boundary. It is not a claim that all route implementations, external credentials, provider accounts, or production service settings have been verified. Route ownership below is derived from the current source registration. Any dynamic or indirect registration is explicitly called out for runtime contract tests.

## 1. Executive decision

**Do not move `src/server/launcher.ts` wholesale to Vercel Functions.** It constructs and starts a long-lived Fastify server, opens PostgreSQL and Redis connections, registers WebSocket and streaming endpoints, and starts background monitors/workers/schedulers. Importing it as a Function entrypoint would risk listener/worker side effects and duplicate process-level work.

The safe first implementation boundary is:

1. Extract a side-effect-free Fastify application factory and route/plugin registration layer.
2. Keep process startup, listeners, worker lifecycle, timers, and graceful shutdown in a separate persistent-runtime entrypoint.
3. Introduce Vercel Function adapters only for individually classified HTTP routes after dependency injection, auth, body parsing, timeout, connection pooling, and integration tests are complete.
4. Keep the current Render API available until cross-platform preview tests and an approved cutover prove parity.

## 2. Current repository and platform configuration

| Surface | Source evidence | Current interpretation |
|---|---|---|
| Root app | `package.json` | Node 24 / npm 10 project; root scripts run API, Vite web, and MCP separately |
| API build | `Dockerfile.api` | Dedicated Node 24 Alpine Docker image; compiles `src/server/launcher.ts` and starts it as a long-running process |
| API runtime | `src/server/launcher.ts` | Fastify listener on `HOST:PORT`; production startup requires PostgreSQL, Redis and the agent checkpointer |
| Frontend build | `vite.config.ts`, `vercel.json` | Vite SPA output to `dist`; `vercel.json` currently describes a Vite frontend build, not a backend API |
| Render desired config | `render.yaml` | Describes Render static frontend, Docker API and Redis with `noeviction` |
| MCP runtime | `mcp-server/Dockerfile`, `mcp-server/package.json`, `mcp-server/http.js` | Existing standalone Node container image; Streamable HTTP transport and listener; stdio transport is also present |
| Root Docker targets | `Dockerfile` | Multi-stage `api`, `web`, and one-shot `migrate` targets; reuses root lockfile and build context |
| Workflow package | `workflows-ryanai/package.json`, `workflows-ryanai/src/main.ts` | Separate Render Workflows SDK task package; durable task orchestration, not a normal request handler |

### Observed control-plane drift (inspection snapshot, 2026-11-03)

- The Render dashboard snapshot showed the API and web services attached to the `rmnganyane-dev` fork, while the checked-in `render.yaml` names the official `RyanAI-Automated` repository. Reconcile the live service connection with the Blueprint before any release.
- The Render web service's configured root directory was reported as `src`; the Vite build writes `dist` relative to the repository root. This is consistent with the observed missing publish directory and must be corrected as a separate Render frontend repair.
- The live Render Redis policy was reported as `volatile_ttl`, while `render.yaml` declares `noeviction`. Treat the dashboard as the current effective state until independently reconciled; PostgreSQL remains the durable source of truth.
- The Vercel project currently has `framework: vite` and the latest inspected deployment was blocked by Verified Commits. Its existing project is not yet evidence of a deployed backend.
- Do not infer that a variable exists, is valid, or has the intended value from its name appearing in a dashboard environment-variable inventory. Never copy secret values into this document or Git.

## 3. HTTP route inventory

The following routes are registered by the current Fastify launcher or plugins. Some routes share a plugin-level authentication hook; per-route authorization must be preserved when extracting handlers.

| Area | Method and path | Current behavior / dependencies | Migration classification |
|---|---|---|---|
| Core health | GET `/`, `/livez`, `/readyz`, `/health`, `/api/health` | Liveness/readiness; readiness probes PostgreSQL, Redis and checkpointer state | Function candidate only for liveness; readiness must use bounded external checks and must not imply worker health |
| Diagnostics | GET `/debug-sentry`, `/api/system` | Test exception and process/runtime information | Keep diagnostics private; review exposure before migration |
| Reasoning | POST `/api/reason` | Authenticated user request; invokes LangGraph reasoning and provider integrations | Conditional Function candidate after bounded execution and database/checkpointer strategy |
| Reasoning stream | POST `/api/reasoning/stream` | Server-Sent Events; runs reasoning and emits progress/handoff events | Hold on persistent runtime until Vercel streaming duration, disconnect handling and provider latency are tested |
| Legacy MCP API | POST `/api/mcp` | Explicitly returns 501; real MCP is on the separate MCP service | Do not migrate as an active capability |
| Authentication | POST `/api/auth/signin`; GET `/api/auth/verify`; POST `/api/auth/login` and `/api/auth/logout` | Sign-in/session verification; legacy login/logout return 410 | Conditional Function candidate after cookie, JWT, CORS and auth-hook extraction |
| Approval | POST `/api/reason/with-approval`, `/api/reason/approve`; GET `/api/admin/threads/:threadId/pending`; POST `/api/admin/threads/:threadId/resolve` | Admin-only LangGraph interrupts/resume using persisted thread state | Conditional candidate; checkpoint store and execution duration must be verified |
| Communications | POST `/api/comms/send`; GET `/api/comms/conversations`, `/api/comms/status` | Twilio and SMTP/Resend integrations plus PostgreSQL communication history | Split: short send/status requests may be candidates; outbound delivery and retries should be durable jobs |
| Twilio webhooks | POST `/api/webhooks/twilio/whatsapp`, `/api/webhooks/twilio/voice`, `/api/webhooks/twilio/voice/respond`, `/api/webhooks/twilio/sms`, `/api/webhooks/twilio/status` | Signature/auth checks, form body parsing, owner identity checks, idempotency and communication persistence | Conditional Function candidates only after raw/form-body signature parity and webhook replay/idempotency tests |
| Resend webhook | POST `/api/webhooks/resend/inbound` | Inbound email webhook with secret/signature validation and communication history | Conditional Function candidate after raw-body/signature tests |
| Slack | POST `/api/slack/interactions` | Raw-body Slack signature validation and form-body parsing | Conditional Function candidate after raw-body and timestamp/replay tests |
| Tasks | GET `/api/tasks`; DELETE `/api/tasks/:id` | User-scoped scheduled-task reads/cancellation; PostgreSQL-backed | Function candidate after auth and database pooling tests; task execution itself remains persistent/durable |
| Agent operations | GET/POST `/api/agent/ops/knowledge`; GET `/api/agent/ops/brains`; POST `/api/agent/ops/brains/probe`; GET/POST `/api/agent/ops/tasks` | Authenticated/admin routes; provider probes and durable task enqueue/list operations | Read/list/enqueue may be candidates; provider probes need bounded timeouts; worker execution stays persistent |
| Engineering jobs | GET `/api/engineering/jobs`, `/api/engineering/jobs/:jobId`, `/api/engineering/jobs/:jobId/evidence-bundle`; POST `/api/engineering/jobs`, `/:jobId/approve`, `/:jobId/steer`, `/:jobId/reject`, `/:jobId/cancel`, `/:jobId/checks`, `/:jobId/evaluations`, `/:jobId/assurance` | Approval-gated engineering jobs and evidence records | Short control-plane operations may be candidates; job execution and long checks must remain durable workers |
| Pending actions | GET `/api/actions`; POST `/api/actions/:id/approve`, `/api/actions/:id/reject` | Approval state and persistence | Function candidate after auth and transaction/idempotency tests |
| Metrics | GET `/api/admin/metrics` | Admin-only process uptime and memory metrics | Do not move as-is: process-local metrics become misleading across ephemeral Function instances |
| Jarvis | GET `/api/jarvis/status`; POST `/api/jarvis/patches`, `/api/jarvis/stacks/publish`, plus patch ingress route | Admin-gated integration, patch proposals and stack publication; ingress separately disabled/token-gated | Candidate only for short authenticated control calls; actual patch/build execution must remain asynchronous and approval-gated |
| Internal Jarvis | GET `/api/jarvis/internal/health`, `/api/jarvis/internal/agents`, `/api/jarvis/internal/tasks`, `/api/jarvis/internal/policy/:agentId/:capability`, `/api/jarvis/internal/audit`; POST `/api/jarvis/internal/tasks` | Internal control-plane task/policy/audit access | Conditional candidate; require service authentication and network/authorization review |
| Internal model gateway | POST `/api/internal/openai/chat` | Bearer-token authenticated model gateway; server-only provider key | Strong Function candidate after token/secret separation, rate-limit and provider-timeout tests |
| Self-patch | POST `/api/patches/apply` | Admin-only proposal to isolated GitHub branch/PR; rate-limited | Candidate only as a short proposal API; no patch execution/build process inside Function |
| Realtime voice | POST `/api/v1/realtime/voice-ticket`; GET WebSocket upgrade `/api/v1/realtime/voice` | Short-lived ticket followed by bidirectional WebSocket proxy to upstream model | Keep on persistent runtime until WebSocket compatibility, connection duration, backpressure and billing are proven |
| WebSocket control | GET WebSocket upgrade `/ws` | Authenticated live connections; in-memory connection/channel maps and timers | Persistent runtime; in-memory state is not safe across independent Function instances |

**Route completeness note:** this is the registered route inventory found in the launcher and route plugins at the audited commit. The extraction PR must add route-contract tests that enumerate Fastify's actual registered routes after plugin registration and fail if a route is omitted from this inventory. It must also resolve any duplicate route registration discovered during app-factory extraction.

## 4. Existing Docker images and Railway workload mapping

Railway is an additional target for existing RyanAI container builds, not a second codebase. Build provenance must point to the same official repository commit used by the coordinated release. No Railway project, service, image publication, environment variables, or deployment is configured by this inventory.

| Existing image/build target | Docker source | Runtime contract | Railway assessment |
|---|---|---|---|
| API image | `Dockerfile` target `api` and standalone `Dockerfile.api` | Fastify listener on `0.0.0.0:$PORT` (default 3000); `/health` Docker healthcheck; PostgreSQL, Redis, checkpointer and provider integrations; launcher currently starts persistent work | **Primary persistent API candidate for staging.** Do not run it as a second production API alongside Render. After PR #756, validate which worker lifecycles remain coupled to the launcher and whether API and worker processes need separate commands/images. Vercel Function route extraction remains a separate, incremental step. |
| MCP HTTP image | `mcp-server/Dockerfile` | Node 24 Alpine; `node http.js`; port 8765; authenticated Streamable HTTP; current Compose healthcheck probes `/health`; depends on API/model gateway and provider configuration | **Strong persistent-service candidate for Railway staging.** Verify the image's actual health endpoint, allowed-host policy, auth token, network path to API/gateway and shutdown behavior before deployment. |
| Web image | `Dockerfile` target `web` | nginx SPA on port 80, proxies API/WebSocket traffic to configured API host | Keep Render as the frontend delivery target in the accepted architecture. Do not also publish the web image on Railway unless a separate, approved fallback test requires it. |
| Migration image | `Dockerfile` target `migrate` | One-shot Prisma migration command; requires database access and must complete before API readiness | Not an always-on Railway service. If evaluated, use a controlled one-shot staging job with explicit database target, migration review and single-run protection. Never attach it as a continuously running service. |
| PostgreSQL / Redis / ClamAV | Compose uses upstream images or external services | Stateful data and network dependencies | Do not blindly deploy Compose-local data services as ephemeral Railway containers. Use approved managed/persistent services and validate backups, network policy, TLS and retention independently. |

### Railway staging rules

- Use the official repository `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`; no build, service or deployment may depend on `rmnganyane-dev` fork.
- Build the existing Dockerfile target/image from a reviewed commit; do not create a duplicate application or invent an image tag. Record immutable image digest and source commit SHA for evidence.
- Keep one active owner for each API listener, worker queue consumer and scheduler. Never run duplicate workers on Render and Railway against the same queue unless the queue protocol explicitly supports coordinated multi-consumer execution and idempotency.
- Staging must use isolated credentials/data and explicit service-to-service URLs. Do not copy production secrets into preview or commit them.
- Verify container startup, `/health` and readiness semantics, restart behavior, graceful shutdown, logs, DB/Redis connectivity, queue ownership, MCP auth and network restrictions.
- Keep production traffic and DNS unchanged. Railway staging success is not production cutover approval.

## 5. Persistent workloads — do not move in the first API migration

| Workload | Source | Why it needs a persistent/durable execution model | Initial target |
|---|---|---|---|
| Fastify process and WebSocket server | `src/server/launcher.ts`, `src/api/websocket.ts` | Listener lifecycle, upgrades, process hooks and in-memory connection state | Render persistent service (or another approved persistent runtime) |
| Durable agent task worker | `src/agent/operations.ts` | PostgreSQL-backed claims, LISTEN/NOTIFY wakeups, periodic recovery sweep, leases/heartbeats and concurrency | Persistent worker; PostgreSQL remains queue authority |
| Brain health monitor | `src/agent/operations.ts` | Repeating timer and provider probes | Persistent worker/scheduler |
| Scheduler | `src/scheduler/runner.ts` | Repeating timer dispatching due tasks | Persistent scheduler |
| Alerts | `src/alerts/runner.ts` | Periodic checks and outbound notifications | Persistent scheduler/worker |
| Attachment scanner | `src/server/attachments/scanner.ts` | Polling queue and ClamAV TCP connection/timeout | Persistent worker; optional feature remains disabled unless explicitly configured |
| Attachment orphan cleanup | `src/server/attachments/orphanCleanup.ts` | Repeating cleanup sweep and database/storage access | Persistent scheduled worker |
| MCP Streamable HTTP | `mcp-server/http.js` | Own Node HTTP listener, MCP transport, auth token and tool lifecycle | Separate persistent service |
| MCP stdio | `mcp-server/stdio.js` | Process-bound stdio transport | Local/controlled process runtime; not an HTTP Function |
| Render Workflow tasks | `workflows-ryanai/src/main.ts` | Durable task/retry orchestration via Render Workflows SDK | Keep on its supported workflow runtime until separately evaluated |
| Native/local inference | `native/`, `src-tauri/`, Python core | Native binaries, local GPU/CPU execution and OS-level dependencies | Desktop/worker runtime; not Vercel Functions |

## 6. Shared dependency and integration map

| Dependency | Current use | Required migration treatment |
|---|---|---|
| PostgreSQL / Supabase | Prisma, `pg` pool, communication/task state, agent runs and LangGraph Postgres checkpointer | Keep existing approved database; use serverless-safe pooled connections for Functions; no migration or schema changes in this phase |
| Redis | Fastify rate limiting, coordination and connection integration | Keep existing approved Redis; retain `noeviction`; do not treat Redis as durable queue authority |
| LangGraph | Reasoning, approval interrupts, persisted thread/checkpoint state | Verify checkpointer lifecycle, connection pool reuse and bounded invocation; long agent execution remains a worker concern |
| Model providers | OpenAI, NVIDIA, Qwen and other configured providers | Server-only credentials; per-provider timeout, retry, quota and failure tests; never expose `VITE_*` secrets |
| Twilio | WhatsApp, SMS, voice, status callbacks | Preserve signature validation, exact externally configured webhook URL, idempotency and raw/form body semantics |
| Resend / SMTP | Inbound and outbound email | Preserve webhook signature verification; use durable queue for outbound retries |
| Slack | Signed interaction webhook | Preserve raw-body signature verification and timestamp tolerance |
| GitHub | Jarvis/self-patch PR creation and repository operations | Use narrowly scoped server-side token; proposal APIs may be Functions, code execution remains separate |
| ClamAV | Attachment scanning over TCP | Persistent scanner worker; do not assume a Function can reach the scanner or finish within invocation limits |
| Render Workflows | Separate `@renderinc/sdk/workflows` package | Keep until workflow durability, retry semantics and platform replacement are independently tested |
| Telemetry | Sentry, OpenTelemetry and Grafana Faro packages | Separate browser and server instrumentation; avoid process-global assumptions in Function cold starts |

## 7. Runtime and data invariants

- PostgreSQL is the durable source of truth for task and application state.
- Redis is transient coordination/cache infrastructure and must use `noeviction`; memory pressure should reject writes rather than evict keys.
- No worker may be started as a side effect of importing an HTTP Function module.
- No Function import may open an unmanaged listener, create an unbounded timer, or start a polling loop.
- All Function database clients must be reused safely within an instance and must use the approved pooler/connection limits.
- Auth, role checks, CORS allowlists, rate limits, webhook signatures and idempotency must remain server-enforced.
- Browser bundles may contain public Supabase configuration only; provider, database, Redis, signing, service-role and internal gateway credentials remain server-side.
- Streaming and WebSocket routes are not assumed compatible based solely on protocol support; end-to-end duration, reconnect, disconnect and backpressure tests are required.
- Every async operation returns a durable task/run identifier and truthful queued/accepted status; it must not claim completion before worker evidence exists.
- Production traffic, DNS, secrets, service plans, database/network configuration and automatic deployment settings are outside this PR.

## 8. Proposed migration sequence and PR boundaries

### PR 1 — This inventory (documentation only)

- Record the current runtime, route, workload and dependency map across Render, Vercel and Railway.
- Identify existing Docker images/targets and classify API, MCP, web and one-shot migration workloads.
- Establish the official repository as the sole source of PR branches and merge targets; deployment connections must not depend on the user fork.
- Identify route groups as candidate, conditional or persistent.
- Make no runtime, platform, environment or deployment changes.

### PR 2 — Extract side-effect-free Fastify application

- Create an application factory that registers plugins and routes without listening or starting workers.
- Keep `launcher.ts` as the persistent process entrypoint responsible for dependency initialization, listener start, background worker start and graceful shutdown.
- Add tests that importing the app factory creates no listener, worker, polling timer or external side effect.
- Add a generated/verified route manifest test against Fastify's registered route table.
- Preserve all existing route paths, auth hooks, CORS, rate limits, raw-body handling and health semantics.

### PR 3 — Add Vercel Function adapter foundation

- Add one minimal Node.js Function adapter using the extracted app/handler boundary.
- Prove request/response conversion, cookies, auth, error handling, body limits, CORS, database pool reuse and cold-start behavior.
- Do not add every route at once; migrate one low-risk route group at a time.
- Keep all persistent workloads on an approved persistent runtime. Evaluate the existing API and MCP Docker images on Railway staging without enabling duplicate production listeners or workers.

### PR 4+ — Migrate route groups by evidence

- Start with low-risk read/control endpoints.
- Add signed webhooks only after raw-body and replay tests.
- Add reasoning and approval endpoints only after checkpointing, timeouts and cost/retry behavior are proven.
- Keep SSE, WebSocket, MCP, task execution, schedulers, alerts and scanners on persistent infrastructure until explicitly redesigned and tested.

### Final cutover gate

A production cutover requires the same reviewed commit SHA and image digest provenance across the participating Render, Vercel and Railway services; green required CI/security checks; preview end-to-end tests from the Render frontend to the selected API endpoint; verified auth/CORS/webhook/realtime behavior; persistent worker ownership evidence; health evidence; rollback references; and explicit human approval. A successful build on one platform is not proof of a coordinated release.

## 9. Validation status and open evidence

| Check | Status |
|---|---|
| Source tree and main runtime manifests inspected | Complete for audited commit |
| Fastify launcher startup and worker lifecycle inspected | Complete for audited commit |
| Main HTTP route plugins enumerated | Source inventory; runtime route-table assertion still required |
| MCP HTTP/stdio process boundaries inspected | Source inventory |
| PostgreSQL/Redis/agent worker architecture inspected | Source inventory; live DB/Redis values not revalidated here |
| Render dashboard vs Blueprint drift identified | Requires operator reconciliation |
| Vercel project currently configured as Vite frontend | Confirmed in project configuration |
| Railway project/service configuration and repository connection | Not configured or verified |
| Existing API Docker image on Railway staging | Not built or tested in Railway |
| Existing MCP Docker image on Railway staging | Not built or tested in Railway |
| Railway health, network, secrets and worker ownership | Not tested |
| Function compatibility and production limits | Not yet tested |
| Cross-platform preview integration | Not yet tested |
| Production migration/cutover | Not performed; approval required |

## 10. Primary source files

- `package.json`
- `Dockerfile`
- `Dockerfile.api`
- `docker-compose.yml`
- `mcp-server/Dockerfile`
- `render.yaml`
- `vercel.json`
- `vite.config.ts`
- `src/server/launcher.ts`
- `src/server/routes/*.ts`
- `src/server/comms/index.ts`
- `src/api/websocket.ts`
- `src/agent/operations.ts`
- `src/agent/queueNotifications.ts`
- `src/agent/agentRunLease.ts`
- `src/scheduler/runner.ts`
- `src/alerts/runner.ts`
- `src/server/attachments/scanner.ts`
- `src/server/attachments/orphanCleanup.ts`
- `mcp-server/http.js`
- `mcp-server/stdio.js`
- `workflows-ryanai/src/main.ts`

This document is an audit snapshot. Update its base commit and re-run the route/runtime inventory whenever the route registry or process lifecycle changes.
