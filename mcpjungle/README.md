# MCPJungle registration for RyanAI

This directory contains explicit MCPJungle configuration, not generated credentials.

## Prerequisites

1. Start the optional gateway profile: `docker compose --profile mcp-gateway up -d mcpjungle-db mcpjungle`.
2. Initialize MCPJungle enterprise mode once using its supported CLI flow: `mcpjungle --registry http://127.0.0.1:8080 init-server`. Protect the resulting admin token in the operator's local secret store.
3. Ensure the RyanAI MCP server is healthy and reachable from the Compose network.

## Register the RyanAI MCP server

The registration config points to the internal Compose service and uses the existing MCP bearer token. It does not embed a token.

PowerShell:
```powershell
$env:RYANAI_MCP_AUTH_TOKEN = (Get-Content .env | Where-Object { $_ -match '^MCP_AUTH_TOKEN=' } | Select-Object -First 1) -replace '^MCP_AUTH_TOKEN=', ''
mcpjungle --registry http://127.0.0.1:8080 register -c .\mcpjungle\ryanai-server.json
```

Bash:
```bash
set -a
. ./.env
set +a
export RYANAI_MCP_AUTH_TOKEN="$MCP_AUTH_TOKEN"
mcpjungle --registry http://127.0.0.1:8080 register -c ./mcpjungle/ryanai-server.json
```

## Create least-privilege Jarvis tool groups

Create the read-only group first:
```bash
mcpjungle --registry http://127.0.0.1:8080 create group -c ./mcpjungle/jarvis-readonly-tools.json
```

The diagnostics group additionally exposes `run_project_checks`, which executes repository validation commands. It is deliberately opt-in: enable the tool in `RYANAI_MCP_ENABLED_TOOLS` only after an administrator has reviewed the command boundary, then create the group:
```bash
mcpjungle --registry http://127.0.0.1:8080 create group -c ./mcpjungle/jarvis-diagnostics-tools.json
```

In enterprise mode, create a dedicated MCP client and grant it only the required group/server access. Keep its generated access token in a secret manager; never commit it or paste it into source. Do not grant the diagnostics group to general-purpose clients.

## Verification

- `mcpjungle list servers` shows the registered `ryanai` server.
- `mcpjungle list tools --server ryanai` shows only tools enabled by RyanAI's operator allowlist.
- `mcpjungle list tools --group jarvis-readonly` (or the CLI's documented group listing) confirms the read-only surface.
- Connect Jarvis using the dedicated group endpoint and client token, then verify tool discovery and a harmless `repository_status` call.
- Confirm a tool not included in the group is unavailable to that client.

Registration and client creation are operator actions. This repository PR does not initialize the gateway, generate credentials, or grant a client access automatically.
