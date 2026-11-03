# RyanAI Connectivity Bridge

The bridge is one standalone service. It has no startup dependency on the API, Vercel Function or MCP process. Redis is the durable event store; Supabase Auth validates browser sessions before a one-time socket ticket is issued.

## Required bridge settings

- \`REDIS_URL\`: authenticated Redis connection with persistence enabled.
- \`SUPABASE_URL\` and \`SUPABASE_PUBLISHABLE_KEY\`: public Supabase project URL and publishable key used to validate access tokens through \`/auth/v1/user\`.
- \`CORS_ORIGINS\`: comma-separated exact browser origins allowed to request tickets and open sockets.
- \`BRIDGE_API_ADAPTER_TOKEN\`, \`BRIDGE_MCP_ADAPTER_TOKEN\`, \`BRIDGE_VERCEL_ADAPTER_TOKEN\`: three independent server-only credentials, minimum 32 characters each. The API token authorizes API heartbeat and user-scoped event publishing; MCP and Vercel tokens authorize only their own heartbeat.
- \`BRIDGE_STREAM_MAX_LENGTH\`: approximate per-user Redis Stream retention limit; defaults to 10,000.
- \`BRIDGE_TICKET_TTL_SECONDS\`: single-use ticket lifetime; defaults to 30 seconds and is capped at 120.

Never put adapter tokens or Supabase privileged keys in browser variables. The bridge does not require a Supabase service-role key.

## HTTP and WebSocket contract

- \`GET /livez\`: process liveness only.
- \`GET /readyz\`: Redis readiness plus independent API, Vercel and MCP capability states. A running bridge does not imply an adapter is ready.
- \`POST /v1/ticket\`: requires \`Authorization: Bearer <current Supabase access token>\`; validates the session with Supabase Auth, rate-limits ticket issuance and returns a random single-use ticket.
- \`GET /v1/socket\`: opens a WebSocket without credentials in the URL.
- As the first WebSocket frame, send \`{"type":"hello","ticket":"<single-use-ticket>"}\`. The bridge consumes the ticket atomically with Redis \`GETDEL\` and responds \`authenticated\`.
- Then send \`{"type":"resume"}\`. The server resumes from the last acknowledged Redis cursor for that user.
- Events are sent as \`{"type":"event","id":"<stream-id>","data":...}\`. Acknowledge only after application handling succeeds with \`{"type":"ack","id":"<stream-id>"}\`.
- Send \`{"type":"heartbeat","nonce":"..."}\`; the bridge responds with \`heartbeat_ack\` and refreshed adapter capabilities. WebSocket ping/pong detects half-open transports.

No credentials are placed in the WebSocket URL. The short-lived ticket is sent only in the first frame, expires quickly and can be consumed once. Long-lived Supabase access tokens and adapter tokens never travel over the WebSocket.

## Durable delivery and recovery

Events are appended to per-user Redis Streams with atomic idempotency keys. The bridge sends at-least-once and advances the persisted cursor only after an in-order acknowledgement. If the bridge or Redis connection fails before an acknowledgement is committed, the event is replayed after reconnect. Consumers must remain idempotent because delivery is at-least-once.

Streams use approximate max-length retention. If the saved cursor predates the oldest retained entry, the bridge emits \`replay_gap\` with \`reconcileRequired: true\`. The consumer must reconcile against authoritative application state; trimmed history cannot be reconstructed by the bridge.

## Independently degradable adapters

- The persistent API process registers at \`/internal/adapters/api/heartbeat\`. It can publish user-scoped events through \`src/server/connectivityBridgeAdapter.ts\` using the API-only token.
- The MCP process registers at \`/internal/adapters/mcp/heartbeat\` using its own token. It cannot publish user-scoped events because it does not have an authenticated user identity.
- The Vercel Function at \`api/bridge/heartbeat.ts\` validates the caller's Supabase session and registers at \`/internal/adapters/vercel/heartbeat\` using the Vercel-only token. Set server-only Vercel variables \`SUPABASE_URL\`, \`SUPABASE_PUBLISHABLE_KEY\`, \`BRIDGE_INTERNAL_URL\` (the bridge HTTPS origin) and \`BRIDGE_VERCEL_ADAPTER_TOKEN\`. Set the non-secret frontend build flag \`VITE_VERCEL_BRIDGE_ADAPTER_ENABLED=true\` to have the signed-in browser invoke this function every 30 seconds.

Adapter heartbeats expire after 45 seconds. A missing or failed adapter is reported as \`unavailable\` without taking the bridge offline.

For Docker Compose, the API and MCP use \`http://connectivity-bridge:8787\` on the private network. The browser uses same-origin \`/bridge\` through Nginx. For separate hosting, set the browser's \`VITE_BRIDGE_BASE_URL\` to the public bridge HTTPS origin and add the exact frontend origin to \`CORS_ORIGINS\`.

## Railway service configuration

The repository includes \`railway.bridge.json\` for a dedicated Railway service. Create a separate service linked to the official repository, keep its root directory at the repository root, and set the service's custom config file path to \`railway.bridge.json\`. The config selects \`connectivity-bridge/Dockerfile\`, probes \`/readyz\` and uses an on-failure restart policy. Railway supplies \`PORT\`; the bridge listens on it when \`BRIDGE_PORT\` is not set.

Configure the bridge variables in Railway's masked variable UI: \`REDIS_URL\`, \`SUPABASE_URL\`, \`SUPABASE_PUBLISHABLE_KEY\`, \`CORS_ORIGINS\`, all three adapter tokens and optionally the stream/ticket settings. Redis must be reachable from the Railway service. Configure the API's internal URL to the private Railway address when both services share a Railway project; Vercel must use the bridge's HTTPS domain.

This is deployment configuration only. It does not create a Railway service, set secrets, provision Redis, assign a domain or deploy anything.

## Validation

\`npm run test:bridge\` runs the stream-store unit tests and isolated integration fault tests. The integration suite starts a local Redis AOF instance and a mock Supabase Auth endpoint; it tests invalid sessions, independent adapter credentials, duplicate publication, ordered acknowledgements, one-time ticket replay/expiry, bridge restart replay, Redis AOF recovery and heartbeat acknowledgements.

A permanent no-disconnect guarantee is impossible across host and network failures. The acceptance target is automatic reconnection with exponential backoff and jitter, heartbeat-based half-open detection, durable replay, explicit degraded state and reproducible fault-injection evidence.
