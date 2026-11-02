# MCPJungle gateway for RyanAI

RyanAI can run MCPJungle as an optional, self-hosted gateway for the RyanAI MCP server. The gateway is deliberately not part of the default Compose startup.

## Why enterprise mode only

MCPJungle's development mode gives every connected MCP client access to every registered upstream server. This deployment fixes `SERVER_MODE=enterprise`, binds the published port to host loopback, stores gateway state in a dedicated PostgreSQL database, and requires clients to be explicitly authorized.

MCPJungle tool groups expose only the selected tool subset through a group endpoint. This is useful for reducing tool discovery and client context, but it is not a replacement for RyanAI's own tool allowlist or authorization checks.

## Start locally

1. Generate a unique 64-character hexadecimal database password and set `MCPJUNGLE_DB_PASSWORD` in your local `.env`. Do not reuse RyanAI's database or Redis password.
2. Start RyanAI and the optional gateway:

   ```sh
   docker compose --profile mcp-gateway up --build --detach --wait
   ```

3. Check the gateway locally:

   ```sh
   curl --fail http://127.0.0.1:8080/health
   ```

The gateway is available at `http://127.0.0.1:8080/mcp`. The PostgreSQL service has no published host port. The gateway is not exposed on a LAN or public interface.

## Initialize and register RyanAI

Install the MCPJungle CLI from the official release for your operating system. Then initialize the enterprise server:

```sh
mcpjungle --registry http://127.0.0.1:8080 init-server
```

Store the generated administrator credential in your password manager. Do not commit it.

The RyanAI upstream registration file is `mcpjungle/ryanai-server.json.example`. Set `RYANAI_MCP_AUTH_TOKEN` in the shell running the CLI to the same secret used as `MCP_AUTH_TOKEN` by the RyanAI MCP service. The CLI resolves the placeholder locally before sending the registration request:

```sh
export RYANAI_MCP_AUTH_TOKEN="$MCP_AUTH_TOKEN"
mcpjungle --registry http://127.0.0.1:8080 register -c mcpjungle/ryanai-server.json.example
```

The registered upstream URL is `http://mcp-server:8765/mcp`; it is resolved inside the shared Docker network, not from the host. The RyanAI MCP server allowlists that internal hostname and requires its own bearer token.

## Least-privilege Jarvis client

The supplied group config `mcpjungle/jarvis-tools-group.json.example` exposes only:
- `tool_registry` — inspect the published tool catalogue and enablement.
- `platform_health` — read the RyanAI API health endpoint.
- `ryanai_stack_manifest` — read the non-secret stack manifest.

These read-only tools are enabled by the default `RYANAI_MCP_ENABLED_TOOLS` setting. Code execution and provider requests are not included. In particular, do not add `run_project_checks` or `reasoning_route` to a shared client group unless you have separately reviewed their execution and provider-cost implications.

Create the group as an enterprise administrator:

```sh
mcpjungle --registry http://127.0.0.1:8080 create group -c mcpjungle/jarvis-tools-group.json.example
```

Create a dedicated Jarvis client and allow only the RyanAI upstream:

```sh
mcpjungle --registry http://127.0.0.1:8080 create mcp-client jarvis --allow "ryanai"
```

Store the generated client token only in Jarvis's secret manager. Connect Jarvis to the group endpoint `http://127.0.0.1:8080/v0/groups/jarvis-readonly/mcp` with `Authorization: Bearer <Jarvis client token>`. Verify the client sees only the tools in the group.

## Remote Jarvis deployments

A Jarvis service outside this Docker network cannot resolve `mcp-server` or reach a loopback-only gateway. Do not publish port 8080 directly. If remote connectivity is required, put MCPJungle behind an authenticated TLS ingress on a private network, restrict source identities, and configure the Jarvis client against the HTTPS group endpoint. The deployment owner must also review host/origin allowlists and network policy.

MCPJungle's enterprise mode currently uses static bearer tokens for MCP clients; its upstream documentation notes that OAuth support is not available yet. Keep client tokens dedicated, scoped and rotatable. Do not reuse the RyanAI MCP server token as the Jarvis client token.

## Operational limits

- The profile is opt-in and has not been started by this PR.
- Server registration, enterprise initialization, client creation and tool-group creation are operator actions; no admin token is generated or stored by the repository.
- MCPJungle is a gateway, not the durable RyanAI agent queue or Jarvis REST service.
- Jarvis's REST bridge remains disabled until a real Jarvis URL and token are configured and a staging handshake succeeds.
- No remote service, network tunnel, deployment or production setting is changed by this integration.
