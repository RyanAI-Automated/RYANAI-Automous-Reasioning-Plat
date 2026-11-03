# RyanAI Connectivity Bridge

The bridge is a separate process and container. It does not depend on API or MCP process availability. Redis is its durable event transport and ticket store.

## Runtime settings

Required: `REDIS_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. Optional: `BRIDGE_PORT` (8787), `BRIDGE_STREAM_MAX_LENGTH` (10000), and `CORS_ORIGINS` (comma-separated exact browser origins).

The bridge validates user access tokens against Supabase Auth before issuing a random 256-bit, 30-second, single-use ticket. The ticket is consumed atomically during the WebSocket upgrade. Never put a provider key or long-lived access token in the WebSocket URL.

## HTTP and WebSocket contract

- `GET /livez`: process liveness only.
- `GET /readyz`: Redis connectivity readiness.
- `POST /v1/ticket`: `Authorization: Bearer <Supabase access token>`; returns a no-store, single-use ticket.
- `GET /v1/socket?ticket=<single-use-ticket>`: authenticated WebSocket upgrade.
- Send `{"type":"resume","cursor":"<stream-id>"}` after connection; omit cursor to use the last acknowledged cursor.
- Events are delivered as `{"type":"event","id":"<stream-id>","data":...}`. Persist the event ID locally and send `{"type":"ack","id":"<stream-id>"}` after the application has safely handled it.

Delivery is at-least-once. Consumers must be idempotent. Redis Streams are retained up to the configured approximate maximum length; an outage longer than retention can require reconciliation from the authoritative application record. The bridge intentionally does not execute API or MCP commands.

## Publishing events

Trusted server-side adapters may append JSON payloads to the authenticated user's stream with Redis `XADD ryanai:connectivity:events:<user-id> MAXLEN ~ <limit> * payload <json>`. Never expose Redis credentials or allow browsers to publish directly.

## Operational boundaries

The bridge can remain available when API or MCP is down, provided Redis and Supabase authentication are available. It cannot guarantee connectivity through host/network failure. Clients must reconnect and request a fresh ticket after a socket closes. A Redis outage degrades delivery; it must not be reported as healthy.
