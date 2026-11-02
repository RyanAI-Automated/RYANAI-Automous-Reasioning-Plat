# Internal Jarvis control plane

RyanAI hosts Jarvis internally. The internal API does not require `JARVIS_BASE_URL` or `JARVIS_API_TOKEN`; those remain solely for optional outbound interoperability.

## Initial API

- `GET /api/jarvis/internal/health`: authenticated readiness check for the internal service and PostgreSQL.
- `GET /api/jarvis/internal/agents`: administrator-only registry of roles, capabilities and permissions.
- `POST /api/jarvis/internal/tasks`: administrator-only durable task submission through the existing AgentRun queue.
- `GET /api/jarvis/internal/tasks`: administrator-only task history.
- `GET /api/jarvis/internal/policy/:agentId/:capability`: administrator-only policy decision.
- `GET /api/jarvis/internal/audit`: administrator-only audit history.

Every submitted engineering task is recorded in the Jarvis audit table. Privileged capabilities (secret access, production changes and deployments) are denied by the registry, including when a caller merely asserts approval. A future privileged executor must independently verify an approval record and enforce a separate execution boundary.

## MCPJungle

The existing optional `mcp-gateway` Compose profile and MCP tool allowlist remain the gateway foundation. Server registration and gateway credentials must be provisioned explicitly by an administrator; this change does not invent an MCPJungle API contract, token, or external Jarvis endpoint.

## Operational boundary

This first vertical slice reuses RyanAI's persisted AgentRun worker queue. It establishes the internal authenticated API, registry policy and durable audit trail. It does not claim that repository sandboxing, patch application, test evidence, MCPJungle registration, or end-to-end approval execution are complete. Those require separate adapters and acceptance tests before the control plane can be called operational.
