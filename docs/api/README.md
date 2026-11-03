# RyanAI API contract

The supported browser API runs from `src/server/launcher.ts` via `npm start`.
The full active HTTP route inventory is `route-inventory.yaml`; the browser-facing
request/response contract is `openapi.yaml`.

## Contract rules

- The API origin is configured through `VITE_API_BASE_URL`; browser code must not
  silently use a different host for authenticated requests.
- Browser API requests use the current Supabase access token in
  `Authorization: Bearer ...`. The API verifies that token with Supabase.
- Authentication and authorization are explicit per route. The global guard
  currently defaults unknown routes to administrator access; this inventory
  records that effective runtime behaviour, including routes whose handler-level
  checks are less restrictive.
- Provider callbacks use provider signatures. Internal machine gateways use
  dedicated tokens. These are not browser-session substitutes.
- `/health`, `/api/health`, and `/livez` are not dependency-readiness evidence.
  Use `/readyz` for the live PostgreSQL, Redis, API and checkpointer probes.
- Reasoning JSON and SSE endpoints delegate to the same durable three-brain
  execution path. SSE is a transport representation, not a second agent engine.
- MCP tool execution belongs to the dedicated Streamable HTTP server at
  `/mcp`; there is no generic API route that echoes tool requests as success.
- The ticketed realtime voice WebSocket at
  `/api/v1/realtime/voice` is separate from the retired generic `/ws`
  simulation socket.

## Findings carried into the authentication compatibility PR

The active launcher retires the legacy local-password paths
`POST /signin` and `POST /api/auth/signin` with HTTP 410. The React
`AuthPage` uses Supabase Auth directly, while the API verifies Supabase bearer
tokens. The stale local-token `authClient` methods for `/api/auth/signup`,
`/api/auth/signin` and `/api/auth/me` have been removed from the frontend API
service. Signup and sign-in remain Supabase client operations.

The current global authentication hook still makes some route groups more
restrictive than their own handlers and comments suggest (notably user task
history and dispatch). This PR deliberately preserves that effective restriction.
A separate authorization-policy change should align the allowlist and tests
without weakening administrative, owner, webhook or machine-token boundaries.

## Validation

Run `npm run api:routes:check` to compare the route inventory and OpenAPI
operations against the route declarations in the supported launcher modules.
The checker uses the repository's existing TypeScript and YAML dependencies.
