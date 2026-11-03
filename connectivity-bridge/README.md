# RyanAI Connectivity Bridge

The bridge is a standalone process/container. It has no startup dependency on the RyanAI API or MCP process. Redis is the durable event store; Supabase Auth verifies browser sessions before a one-time socket ticket is issued.

## Required runtime settings

- \`REDIS_URL\`: authenticated Redis connection.
- \`SUPABASE_URL\` and \`SUPABASE_PUBLISHABLE_KEY\`: the public Supabase project URL and publishable key used to validate access tokens through \`/auth/v1/user\`.
- \`CORS_ORIGINS\`: comma-separated exact browser origins allowed to request tickets and open sockets.
- \`BRIDGE_ADAPTER_TOKEN\`: optional server-only token (minimum 32 characters) for API/MCP heartbeats and server-side event publishing.
- \`BRIDGE_STREAM_MAX_LENGTH\`: approximate per-user Redis Stream retention limit; defaults to 10,000.
- \`BRIDGE_TICKET_TTL_SECONDS\`: short-lived single-use ticket lifetime; defaults to 30 seconds and is capped at 120.

Do not put service tokens or Supabase privileged keys in browser variables. The bridge never needs a Supabase service-role key.

## HTTP and WebSocket contract

- \`GET /livez\`: process liveness only.
- \`GET /readyz\`: Redis readiness plus separate API/MCP capability states. A running bridge does not imply either adapter is ready.
- \`POST /v1/ticket\`: requires \`Authorization: Bearer <current Supabase access token>\`; validates the session with Supabase Auth, rate-limits ticket issuance, and returns a random single-use ticket.
- \`GET /v1/socket?ticket=<single-use-ticket>\`: consumes the ticket atomically during the WebSocket upgrade.
- After connecting, send \`{"type":"resume"}\`. The server resumes from the last acknowledged Redis cursor for that user.
- Events are sent as \`{"type":"event","id":"<stream-id>","data":...}\`. Acknowledge only after application handling succeeds with \`{"type":"ack","id":"<stream-id>"}\`.
- Send \`{"type":"heartbeat","nonce":"..."}\`; the bridge responds with \`heartbeat_ack\`. WebSocket ping/pong also detects half-open transports.

No credentials are placed in the WebSocket URL. The short-lived ticket is sent only in the first frame, expires quickly and can be consumed once. Long-lived Supabase access tokens and adapter tokens are never sent over the WebSocket.

## Durable delivery semantics

Events are appended with Redis Streams using an atomic idempotency key. The bridge sends at-least-once and only advances the persisted cursor after an in-order acknowledgement. If a bridge or Redis connection fails before an acknowledgement is committed, the event is replayed after reconnect. Duplicate processing remains possible; consumers must be idempotent.

Redis Streams use approximate max-length retention. If the stored cursor predates the oldest retained entry, the bridge emits \`replay_gap\` with \`reconcileRequired: true\`. The consumer must reconcile against the authoritative application record; the bridge does not claim that trimmed history can be reconstructed.

## API and MCP adapters

The API and MCP processes independently POST authenticated heartbeats to \`/internal/adapters/api/heartbeat\` and \`/internal/adapters/mcp/heartbeat\`. Heartbeats expire after 45 seconds. A missing adapter is reported as \`unavailable\` without taking the bridge offline.

Trusted server-side publishers may POST \`{userId,idempotencyKey,payload}\` to \`/internal/events\` with the API adapter token. The MCP token cannot publish events. The helper in \`src/server/connectivityBridgeAdapter.ts\` is used by the API. The MCP process currently registers availability only; it must not publish user-scoped events without a verified user identity.

For a Vercel-hosted backend, set \`BRIDGE_INTERNAL_URL\` to the bridge's HTTPS origin and \`BRIDGE_ADAPTER_TOKEN\` in the backend's server-only environment. For the Docker Compose network, the internal URL is \`http://connectivity-bridge:8787\`. The browser uses same-origin \`/bridge\` through Nginx; set \`VITE_BRIDGE_BASE_URL\` only when the browser must connect to a separate public bridge origin.

## Local and fault-injection validation

\`npm run test:bridge\` runs Redis stream unit/fault tests. The bridge integration workflow starts an isolated Redis AOF instance and a mock Supabase Auth endpoint, then exercises adapter degradation, duplicate publish, bridge restart, Redis restart/AOF recovery, heartbeat and ticket expiry. It does not touch production services.

## Operational boundary

A permanent no-disconnect guarantee is impossible across host and network failures. The acceptance target is automatic reconnection with exponential backoff and jitter, heartbeat-based half-open detection, durable replay, explicit degraded state and reproducible fault-injection evidence.

## Railway service configuration

The repository includes `railway.bridge.json` for a dedicated Railway service. Create a separate service linked to the official repository, keep its root directory at the repository root, and set that service's custom config file path to `railway.bridge.json`. The config selects `connectivity-bridge/Dockerfile`, probes `/readyz`, and uses an on-failure restart policy. Railway supplies `PORT`; the bridge listens on it when `BRIDGE_PORT` is not set.

Configure these service variables in Railway's masked variable UI (do not commit values): `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CORS_ORIGINS`, `BRIDGE_API_ADAPTER_TOKEN`, `BRIDGE_MCP_ADAPTER_TOKEN`, and optionally `BRIDGE_STREAM_MAX_LENGTH` / `BRIDGE_TICKET_TTL_SECONDS`. The Redis endpoint must be reachable from this Railway service. Configure the API's `BRIDGE_INTERNAL_URL` to the bridge's private Railway address when both services share a Railway project; for a Vercel-hosted API, use the bridge's HTTPS domain. Configure the browser's `VITE_BRIDGE_BASE_URL` and the exact frontend origin in `CORS_ORIGINS` when the browser connects cross-origin.

This is deployment configuration only: it does not create a Railway service, set secrets, provision Redis, assign a domain, or deploy anything.
