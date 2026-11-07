# RyanAI topology integration backlog

**Parent:** Canonical topology and deployment contract.
**Baseline:** `350c635b7904e0e5379f09987ace9995f0b0212c`.
**Sequencing:** PR A (this documentation contract) → PR B (API/data-plane integration) → PR C (workers/MCP/module execution).
**Policy:** Separate branches and review; no auto-merge. Exact-head CI/security evidence required. No production deployment, production migration, secret changes, paid upgrades, or live outbound communications.

## PR B — Canonical API, identity, persistence and data-plane integration

### Objective

Prove one authenticated request path from the RyanAI client through the canonical API and Gen-X policy boundary to the authoritative Supabase PostgreSQL/pgvector store. Keep the existing Render API route as the transition route until a separate Vercel compatibility review passes.

### Work packages

1. **API entrypoint and ownership inventory**
   - Map all HTTP routes, websocket/streaming endpoints, uploads, callbacks, scheduled work, and long-running handlers.
   - Identify process-local state, filesystem writes, startup side effects, and provider-specific assumptions.
   - Declare which operations are request/response API work and which must become durable jobs.
   - Do not add a second API implementation or repoint production traffic.

2. **Identity and policy propagation**
   - Verify Supabase Auth token/session validation at the server boundary.
   - Derive owner/tenant scope from the verified principal; reject caller-supplied identity/role overrides.
   - Ensure Gen-X authorization is checked at the action boundary and fails closed if identity or policy is unavailable.
   - Add/extend negative tests for cross-owner reads/writes and model-supplied identity claims.

3. **PostgreSQL and pgvector**
   - Inventory Prisma schemas, migrations, connection paths, pooler requirements, and runtime CA configuration.
   - Verify disposable/staging connectivity through the intended Supabase Session Pooler using strict TLS and system CA roots.
   - Verify migration status and apply migrations only in disposable/staging under a reviewed procedure; no production migration.
   - Verify owner-scoped CRUD, vector index/version isolation, provenance, and deletion propagation.
   - Confirm application startup does not run schema migrations.

4. **API contract and frontend integration**
   - Publish a versioned API contract for auth, errors, pagination, task creation/status, and correlation IDs.
   - Verify the existing Render frontend's configured API origin and CORS/cookie/token behaviour in a non-production test environment.
   - Add contract/integration tests for browser → API → auth → Gen-X → database.
   - Record whether the API can be adapted to Vercel stateless execution; document blockers rather than changing providers in this PR.

5. **Operational evidence**
   - Distinguish liveness from readiness; readiness must report dependency state without leaking credentials.
   - Add request correlation and structured error classification where missing.
   - Produce a reproducible staging test report with commit SHA, test command, exit code, and sanitized evidence.

### Acceptance criteria

- Authenticated owner can perform permitted API/database operations.
- Unauthenticated, expired, cross-owner, and forged-identity requests are rejected.
- Gen-X denial prevents side effects.
- PostgreSQL/pgvector staging probes pass with strict TLS; no insecure TLS bypass.
- Migration status is verified without production migration.
- Frontend-to-API contract tests pass against the canonical route.
- Startup performs no automatic production migration.
- API route/runtime inventory explicitly records Vercel compatibility and remaining blockers.
- Exact-head required CI and security checks pass; human review approves.

### Explicit exclusions

No production API cutover, Vercel traffic switch, production migration, secret change, new database, new provider, paid plan, communications activation, or change to the owner identity system.

## PR C — Durable workers, MCP gateway and product execution integration

### Objective

Make background work and module execution real, recoverable, permission-checked, and observable using the existing durable data foundation and selected providers.

### Work packages

1. **Durable task lifecycle**
   - Define a versioned task envelope: task ID, owner/tenant, task type, schema version, idempotency key, correlation ID, deadline, status, attempt, and provenance.
   - Persist authoritative task state/checkpoints in PostgreSQL.
   - Use Redis/Valkey only for ephemeral queue acceleration/coordination.
   - Implement worker claim leases, heartbeat, bounded retry/backoff, cancellation, dead-letter state, graceful shutdown, and restart recovery.
   - Prove duplicate delivery does not duplicate externally visible side effects.

2. **Worker deployment contracts**
   - Inventory current worker scripts and runtime dependencies (including coding and audiobook workers).
   - Assign persistent Docker worker processes to Railway only after a non-production deployment plan and service health/readiness contract are reviewed.
   - Ensure workers do not run migrations on startup and do not receive unnecessary production credentials.
   - Keep Railway's current API Docker declaration classified as a transition/ambiguous deployment contract until its actual service use is reconciled; do not assume it is a worker.

3. **MCP and tool gateway**
   - Standardise tool registration, typed input/output schemas, capability scopes, timeout, audit, and error contracts.
   - Authenticate service-to-service calls and propagate verified owner/tenant identity.
   - Re-authorize each tool invocation at execution time; deny by default.
   - Separate read-only tools from state-changing tools and bind consequential approval to the exact action payload.
   - Verify MCP health and tool-level allow/deny tests; no unrestricted shell, filesystem, network, GitHub write, or deployment capabilities.

4. **Module integration**
   - Memory Vault: common owner-scoped memory API, provenance, correction/deletion semantics.
   - Studio/Audiobook: durable render/task status, private artifact ownership, cancellation and retry.
   - Comms: draft/review/dispatch separation; dispatch remains disabled absent provider callback, verified destination, and explicit test authorization.
   - Quant Lab: isolated paper-only task execution; prove no brokerage/order execution path is enabled.
   - Engineering/Jarvis: read-only by default; patch proposals remain branch/PR artifacts subject to human review.

5. **Observability and recovery**
   - Correlate API request, task, worker, model, MCP tool, Gen-X decision, approval, and result.
   - Add worker heartbeat/queue age/retry/dead-letter metrics and actionable health checks.
   - Exercise worker termination, Redis loss, model timeout, MCP unavailability, duplicate event, and database interruption in controlled tests.
   - Verify durable work resumes safely without lost task state or duplicate side effects.

### Acceptance criteria

- A task is durably created, claimed, executed, completed, and queryable end-to-end.
- Worker restart recovers leased/queued tasks correctly.
- Duplicate task delivery is idempotent.
- Retry exhaustion produces an inspectable dead-letter state.
- MCP tool calls are authenticated, schema-validated, authorized and audited.
- Denied tool calls have no side effects; consequential action approval is digest-bound.
- Memory, Studio, Audiobook, Comms and Quant Lab use common identity/task/audit contracts.
- Comms remains gated and Quant remains paper-only.
- Exact-head CI/security and integration tests pass; human review approves.

### Explicit exclusions

No production worker cutover, live external message dispatch, real trading/brokerage, production DB migration, secret modification, paid infrastructure upgrade, auto-merge, or model self-authorization.

## Dependency order and exit gates

| Order | Deliverable | Must precede |
| --- | --- | --- |
| PR A | Canonical topology and truthful current-vs-target deployment contract | PR B and PR C |
| PR B | Verified identity, API contract, staging persistence and policy boundary | PR C production-grade task/tool integration |
| PR C | Durable task execution, worker lifecycle, MCP and module E2E | Beta operational certification |

PR B and PR C may have independent preparatory work, but PR C's integrated acceptance depends on PR B's verified identity and persistence contracts. Beta certification remains a separate evidence decision; merging these PRs does not itself certify Beta readiness.


---

## 4. API + MCP Render convergence amendment — 7 November 2026

The hosting decision is updated: **Render is the common platform for both the canonical API and the MCP HTTP service**. They remain separate services and security boundaries, not duplicate APIs. Render web and API service declarations remain as-is until the separately reviewed deployment-contract PR. A proposed `ryanai-mcp` Render service is blocked until `mcp-server/http.js` supports Render's assigned port/interface and exact Host/Origin policy, and service-to-service delegated identity is implemented.

### PR B — API/data-plane implementation (expanded)

- Inventory all API routes, middleware, authentication, identity derivation, Gen-X policy calls, model endpoints, memory/database access, task lifecycle, health/readiness and outbound integrations.
- Establish versioned API envelopes: request/correlation ID, verified actor/tenant, schema version, idempotency key, deadline, policy decision reference and typed error.
- Standardise canonical model roles to `nvidia`, `qwen`, `logic`, `ollama`; map NVIDIA/Nemotron and OpenAI-compatible Logic provider names behind adapters. Keep DeepSeek/TorchTPU experimental and disabled until separately approved.
- Implement Supabase Auth verification and server-derived owner/tenant scope; add forged identity, cross-owner and denied-side-effect tests.
- Verify Supabase Session Pooler and strict CA/TLS in staging; never migrate production or change secrets.
- Keep API as the only database authority and model-routing authority. MCP must not hold database credentials or direct provider keys.

### PR C — MCP/gateway implementation (expanded)

- Build one canonical tool registry package/schema consumed by MCP Manager and legacy RyanMCP/SystemMCP adapters.
- Standardise tool metadata: stable ID/version, owner, risk, capability scope, input/output schema, timeout, idempotency, approval, audit and enablement.
- Add API-issued delegated identity with audience, expiry, actor/tenant and request/correlation IDs; shared MCP token remains service authentication only.
- Re-check Gen-X authorization at execution time; fail closed if identity/policy unavailable.
- Align public MCP brain enum with the four canonical role IDs; route provider calls through API-owned model gateway.
- Verify MCPJungle server registration and Jarvis client effective grants at runtime; JSON declarations alone are not acceptance evidence.
- Keep shell, arbitrary filesystem/network, GitHub write, deployment, private memory, comms dispatch and real trading tools unavailable by default.
- Prove host/port binding, Host/Origin allowlist, bearer validation, request limits, shutdown, health and readiness for Render.

### PR D — deployment/configuration reconciliation

- Update Render Blueprint with a distinct MCP service only after its runtime contract and security tests pass. Preserve `autoDeployTrigger: off`; PR does not authorize Blueprint sync or deployment.
- Reconcile `Dockerfile.api`, `mcp-server/Dockerfile`, `railway.json`, `render.yaml`, `stacks/ryanai.stack.json`, its JSON Schema, Compose/Kubernetes declarations and validation scripts to one service ownership map.
- Remove or mark unsupported duplicate/legacy topology declarations only after exact consumer inventory; do not delete working services or providers by inference.
- Keep Supabase PostgreSQL/pgvector authoritative, Redis/Valkey ephemeral, and Railway persistent workloads unassigned until the Primary Railway project is verified.

### PR E — verification and exit criteria

- Exact reviewed SHA has complete passing required CI/security checks; no missing/queued/skipped/cancelled/provider-blocked checks count as passes.
- API tests cover identity, authorization, CORS/Host, readiness, idempotency, database strict TLS, model adapter mapping and provider failure.
- MCP tests cover one registry, schema validation, capability allow/deny, delegated identity, Gen-X re-check, digest-bound approval, request limits and audit.
- API↔MCP integration proves denied calls have no side effects and every permitted call is correlated.
- MCPJungle registration and per-client effective grants are observed from a running non-production gateway.
- Render staging smoke test verifies web→API→auth→Gen-X→database and API→MCP→registry→policy→tool.
- No production deploy, production migration, secret mutation, paid upgrade, live external communication, real trading or auto-merge.
