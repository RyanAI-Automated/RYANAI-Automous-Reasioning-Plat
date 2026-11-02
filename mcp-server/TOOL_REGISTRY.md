# RyanAI MCP tool registry

The MCP manager exposes a read-only `tool_registry` catalogue and keeps action tools disabled unless an operator explicitly enables them.

## Enablement

Set `RYANAI_MCP_ENABLED_TOOLS` to a comma-separated list of exact tool names:

```sh
RYANAI_MCP_ENABLED_TOOLS=platform_health,repository_status
```

The registry is fail-closed:

- An unset or empty variable exposes only `tool_registry`.
- Unknown names cause MCP server startup to fail instead of silently accepting a typo.
- A configured tool that is not available in the current runtime causes startup to fail.
- `tool_registry` is always available for read-only discovery and cannot be added to the action allowlist.
- Tool metadata reports ownership, risk, availability, enablement, and the enablement mechanism.

## Current boundary

This is the first control-plane increment, not a complete enterprise gateway. The allowlist is operator-managed process configuration and applies to the MCP service as a whole. It does not yet provide per-user delegated identity, per-tool OAuth scopes, dynamic registry administration, protocol translation to arbitrary downstream services, or policy decisions through OPA. Do not treat the shared MCP bearer token as an end-user identity.

The existing HTTP transport authentication and host/origin checks remain in place. Keep the MCP listener loopback-bound unless a separately reviewed deployment configures a strong `MCP_AUTH_TOKEN` and a narrow `MCP_ALLOWED_HOSTS` allowlist.

## Validation

Run `npm --prefix mcp-server run check`. The check includes unit tests for default-deny behavior, explicit allowlisting, unknown names, unavailable tools, and registry metadata.
