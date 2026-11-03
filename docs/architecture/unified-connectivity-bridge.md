# RyanAI Unified Connectivity Bridge

Status: design and repository audit; implementation and runtime verification are pending.

## Objective

Provide a recoverable communication plane between browser clients, backend services, and containerised workloads. A transport interruption must not become a permanent loss of connectivity or silently lose acknowledged work.

A literal never-disconnect guarantee is not possible across process, host, and network failures. The acceptance target is automatic recovery, explicit degraded state, and durable at-least-once delivery with idempotent processing.

## Repository audit (main at a1067a215c53c5d714cfdadff09337d011351a86)

### Existing building blocks

- `docker-compose.yml` places web, API, MCP, PostgreSQL, and Redis on `ryanai-net`.
- The API, web, Redis, PostgreSQL, and MCP services have health checks and restart policies.
- `nginx.conf.template` proxies `/api/` and `/ws` to the API and configures WebSocket upgrade headers.
- `src/server/launcher.ts` registers Fastify WebSocket routes and requires PostgreSQL and Redis for production readiness.
- `src/api/websocket.ts` maintains process-local connection and subscription maps.
- `src/api/client.ts` has a finite reconnect limit (default five), fixed-delay retry, no jitter, no heartbeat, and no durable outbox/replay.
- `app/page.tsx` opens a telemetry WebSocket once and marks it offline on close; it does not reconnect.
- `src/hooks/useTelemetrySocket.ts` also opens a one-shot socket without reconnect.
- `src/services/mcpClient.ts` defaults to `http://localhost:9100/mcp`, while Compose configures the MCP server on container port 8765. Its JSON POST protocol must be checked against the actual MCP Streamable HTTP endpoint before changing it.
- `src/api/websocket.ts` currently returns timed, fabricated progress events for `reasoning.start` rather than invoking the real reasoning workflow. This must not be mistaken for a functioning reasoning bridge.

### Critical architectural constraints

1. The current `/ws` endpoint is hosted by the API. It cannot remain available if that API process is down. A separate bridge process/service is required to make API availability optional.
2. Browser WebSocket APIs cannot set arbitrary Authorization headers. The browser handshake must use the existing secure same-site cookie/session mechanism or a short-lived, single-use connection ticket. Do not put bearer tokens in query strings or long-lived subprotocol values.
3. Connection/subscription maps are process-local and disappear on restart. Cross-instance delivery needs a shared broker and durable event/outbox store.
4. Redis is already part of the Compose stack with AOF enabled. Redis Streams may support a first durable queue implementation, but persistence guarantees, retention, consumer groups, pending-entry recovery, and idempotency must be tested. PostgreSQL remains the authoritative business record store.
5. The API currently fails production startup when required PostgreSQL/Redis/checkpointer dependencies are unavailable. Making API an optional adapter requires separating bridge liveness/readiness from API readiness; it must not weaken API's fail-closed production checks.
6. Existing health endpoints must distinguish liveness, readiness, and dependency status. A healthy Nginx static response is not proof that the backend or bridge is healthy.

## Target architecture

- Dedicated `ryanai-bridge` service/container owns browser-facing WebSocket connections and a versioned transport protocol.
- Frontend connects to the bridge through the same-origin edge route; no direct container IPs or internal ports are exposed.
- Bridge owns heartbeat, connection leases, reconnect backoff with jitter, authentication renewal, subscription restoration, message acknowledgements, and bounded client outbox.
- A durable broker/outbox (initial candidate: Redis Streams with AOF, consumer groups, pending-entry recovery, retention limits, and idempotency keys) decouples the bridge from API and MCP.
- API and MCP are independent adapters registered in a service registry with capability, readiness, and lease expiry. Missing adapters produce explicit degraded capabilities, not bridge shutdown.
- API work that changes business state must persist its task/result in the existing durable application store before acknowledgement. Delivery is at-least-once; consumers must be idempotent. Exactly-once delivery is not claimed.
- Bridge control-plane health is independent of adapter health. The bridge must not report a provider or adapter as healthy merely because its container is running.

## Implementation sequence

1. Add protocol types and contract tests (connection lifecycle, heartbeat, auth expiry, idempotency, acknowledgements, replay cursors, queue bounds).
2. Implement a standalone bridge process and Docker target/service with graceful shutdown, health endpoints, and non-root runtime.
3. Add the shared broker adapter and durable outbox/consumer recovery; validate Redis AOF and restart behaviour. No database schema changes in this workstream.
4. Replace one-shot frontend telemetry connections with a shared reconnecting client: exponential backoff + jitter, heartbeat timeout, cancellation on unmount, subscription restoration, bounded queue, and explicit offline/degraded states.
5. Route browser traffic through same-origin edge proxy to the bridge. Keep backend API routes separately proxied.
6. Convert API and MCP into optional, authenticated capability adapters. Correct MCP transport only after verifying the server's actual Streamable HTTP route and SDK contract.
7. Remove the fabricated reasoning WebSocket response path and route real reasoning requests through the durable task interface; do not silently claim simulated work succeeded.
8. Add integration tests for API disabled, MCP disabled, bridge restart, Redis restart, browser network loss, duplicate delivery, replay, auth expiry, and multi-instance fan-out.
9. Run targeted tests, full typecheck/lint/build, Docker image build, Compose health, and fault-injection tests. Record evidence and limitations in the PR.

## Acceptance criteria

- Browser automatically reconnects with bounded exponential backoff and jitter.
- Heartbeats detect half-open sessions.
- Subscriptions resume from an acknowledged cursor after reconnect.
- Acknowledged durable work survives bridge/API/MCP process restarts and is replayed safely.
- Duplicate deliveries are harmless through idempotency keys.
- API and MCP can be stopped independently without stopping the bridge.
- Bridge remains explicitly degraded when required broker/auth infrastructure is unavailable; it never reports false healthy status.
- Authentication is renewed safely; no long-lived secrets appear in browser URLs or logs.
- Container health checks test the service's actual readiness, not merely a static proxy response.
- CI/security checks remain intact; human review is required before merge.

## Scope and safety

- Separate branch from database PR #770.
- No production deployment, service restart, secrets change, database schema/migration change, paid plan change, or merge.
- PR remains draft until implementation and required CI/security evidence are complete.
- Do not claim uninterrupted connectivity; claim recoverable connectivity only after fault-injection evidence.
