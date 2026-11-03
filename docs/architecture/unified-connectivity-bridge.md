# RyanAI Unified Connectivity Bridge

Status: implementation in progress; runtime verification and CI acceptance are pending.

## Canonical topology

- One standalone Node bridge process runs from `bridge-runtime/server.mjs` in the `bridge` Compose service and `Dockerfile.bridge` image.
- Nginx routes `/bridge/` to the bridge service. Browser WebSockets connect to `/bridge/ws`; the proxy strips the prefix and forwards `/ws`.
- The API authenticates the signed-in user, then requests a short-lived ticket from the bridge over the private Compose network using `BRIDGE_ISSUER_TOKEN`.
- Browser clients send the ticket in the first WebSocket protocol frame, not in a URL. Tickets are HMAC-signed, expire within 120 seconds, and are consumed once through Redis.
- API and MCP are optional adapters. They use `BRIDGE_API_ADAPTER_TOKEN` and `BRIDGE_MCP_ADAPTER_TOKEN` to publish events and refresh independent heartbeats. Their outage does not stop bridge startup or the other adapter.
- Redis Streams are the durable delivery transport. User events are partitioned by user ID and topic. The MCP adapter publishes only non-user-specific status events on the shared `agent.status` stream.

## Delivery and recovery guarantees

- Delivery is at-least-once. Clients process events serially and acknowledge only after the application handler succeeds.
- Acknowledgement cursors are stored per user, topic, and stream source. A reconnect resumes after the last acknowledged event, so unacknowledged events are replayed.
- Publisher idempotency keys are deduplicated atomically with Redis Lua before an event is appended.
- Redis AOF is enabled in Compose. Stream retention is bounded; events beyond retention require reconciliation from authoritative application records.
- Heartbeats detect dead browser sockets. The browser client obtains a fresh ticket and reconnects with exponential backoff and jitter.
- Bridge readiness depends on Redis. API/MCP availability is reported separately as adapter capability state; a healthy bridge does not imply healthy API or MCP.
- This is not exactly-once delivery and cannot prevent all network disconnects. It provides recovery without silently discarding acknowledged work.

## Internal contracts

- `POST /internal/tickets`: API-only issuer token; body contains subject, allowed topics, and TTL.
- `POST /internal/events`: adapter-only token; body contains userId, topic, idempotencyKey, and payload. The reserved `system` user may publish only `agent.status`.
- `POST /internal/adapters/{api|mcp}/heartbeat`: refreshes a 45-second adapter liveness lease.
- `GET /health/live`: process liveness.
- `GET /health/ready`: Redis-backed readiness.
- `GET /ws`: version 1 WebSocket protocol; first frame is `hello`, followed by `subscribe`, `heartbeat`, and ordered `ack` frames.

## Required environment

Set three independently generated secrets: `BRIDGE_TICKET_SECRET`, `BRIDGE_ISSUER_TOKEN`, and `BRIDGE_ADAPTER_TOKEN`. Each must contain at least 32 characters. Configure `BRIDGE_ALLOWED_ORIGINS` with exact browser origins in each deployment environment. Do not commit generated values.

## Validation gates

The dedicated bridge fault-injection workflow starts an isolated Redis server and tests:
- API and MCP adapter absence/degradation independently.
- Duplicate event publication and idempotent cursor response.
- Bridge process restart with unacknowledged event replay.
- Redis restart with AOF recovery and bridge client reconnection.
- Expired single-use ticket rejection.

The legacy API WebSocket reasoning handler now returns an explicit retirement error instead of fabricating progress. The full repository typecheck, lint, unit tests, Docker image build, Compose config validation, security scans, and human review remain required before merge. No production deployment, restart, database migration, secret rotation, paid upgrade, or merge is authorized by this PR.
