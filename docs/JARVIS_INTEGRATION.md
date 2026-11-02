# Jarvis, MCPJungle, and accelerator integration

This document joins the existing Jarvis bridge, RyanAI MCP manager, optional MCPJungle gateway, DeepSeek Flash adapter, and optional TorchTPU-backed model-serving endpoint into one operator-controlled workflow.

## What is already implemented in RyanAI

- **Jarvis outbound bridge:** administrator-only API routes expose status, patch proposal submission, and non-secret stack-manifest publication. Outbound requests require `JARVIS_BASE_URL`, `JARVIS_API_TOKEN`, and `JARVIS_SYNC_ENABLED=true`.
- **Jarvis inbound patch bridge:** `POST /api/jarvis/patches/apply` is disabled unless `JARVIS_PATCH_INGRESS_ENABLED=true` and a separate `JARVIS_INGRESS_TOKEN` are configured. Accepted candidates pass through RyanAI's sandboxed patch verification pipeline; this does not automatically create a Git commit, PR, merge, or deployment.
- **RyanAI MCP manager:** `/mcp` offers health, repository status, stack manifest, reasoning, project-check, and tool-registry capabilities. Action tools are controlled by `RYANAI_MCP_ENABLED_TOOLS`; the registry is always read-only and discoverable.
- **DeepSeek Flash:** optional OpenAI-compatible MCP reasoning route, with JSON validation and no implicit execution of model tool calls.
- **Durable agent orchestration:** queue/worker, leases, recovery and handoff telemetry are in the main application; their live operational state still needs to pass the current CI and staging checks.

## End-to-end topology

```text
Jarvis agent (client identity + allow-list)
        |
        | Streamable HTTP /mcp + client bearer token
        v
MCPJungle (enterprise mode, per-client ACLs, tool groups)
        |
        | internal Docker network; upstream bearer token
        v
RyanAI MCP manager (MCP_AUTH_TOKEN)
        |
        +--> health / repository / stack manifest / reasoning / project checks

Jarvis patch service
        |
        | HTTPS + separate JARVIS_INGRESS_TOKEN
        v
RyanAI API /api/jarvis/patches/apply
        |
        v
Sandboxed patch verification --> human-reviewed Git PR --> required CI/review
```

The existing direct Jarvis REST bridge is separate from MCPJungle: RyanAI uses its outbound Jarvis token for health, patch proposals and stack metadata. MCPJungle centralizes MCP server access; it is not a replacement for Jarvis's patch REST contract.

## Start the optional MCPJungle enterprise gateway

MCPJungle is a separate open-source service (MPL-2.0), pinned here to release `0.4.7`. The Compose profile is off by default and uses a dedicated PostgreSQL database; it does not reuse RyanAI's application database.

1. Generate a unique URL-safe database password and set it as `MCPJUNGLE_DB_PASSWORD` in the server-side `.env` file. Do not reuse RyanAI's `DB_PASSWORD`.
2. Start only the optional gateway services:

   ```sh
   docker compose --profile mcp-gateway up -d mcpjungle-db mcpjungle
   ```

3. Verify the local-only gateway health endpoint at `http://127.0.0.1:8080/health`.
4. Install the matching `mcpjungle` 0.4.7 CLI on a trusted operator workstation. Initialize the enterprise server and register RyanAI's MCP endpoint:

   ```sh
   mcpjungle init-server
   mcpjungle register --name ryanai --url http://mcp-server:8765/mcp --bearer-token "$MCP_AUTH_TOKEN"
   ```

   Run these commands against the local gateway configured at `http://127.0.0.1:8080`. The registered upstream hostname `mcp-server` resolves inside the shared Docker network; the operator workstation does not need to resolve it.

5. Create a dedicated Jarvis MCP client with only the RyanAI upstream allowed:

   ```sh
   mcpjungle create mcp-client jarvis --allow "ryanai"
   ```

   Store the generated client token in Jarvis's secret manager. Do not reuse the gateway admin token or RyanAI's upstream token. For a remote Jarvis service, expose MCPJungle only through an authenticated HTTPS reverse proxy and configure its public origin and host-header protections correctly.

The gateway listens on a loopback-only host port by default. Do not change that binding to a public interface without TLS, authentication, and an explicit access review. MCPJungle's enterprise mode requires server initialization and per-client allow-lists; development mode grants every connected client access to all registered servers and is not appropriate for shared Jarvis use.

### Suggested Jarvis tool group

After registering RyanAI, inspect canonical tool names with `mcpjungle list tools`, then create a Jarvis-specific group. Example structure (replace names with the exact discovered names):

```json
{
  "name": "jarvis-ryanai",
  "description": "RyanAI read, diagnostics, and reasoning tools for Jarvis",
  "included_tools": [
    "ryanai__tool_registry",
    "ryanai__platform_health",
    "ryanai__repository_status",
    "ryanai__ryanai_stack_manifest",
    "ryanai__reasoning_route"
  ]
}
```

Keep `run_project_checks` disabled until Jarvis is authorized to execute repository validation in the connected workspace. Keep patch application on the separately authenticated REST ingress route; do not expose self-patching as a general-purpose MCP tool. MCPJungle tool groups currently do not expose prompts/resources, so keep any required prompt/resource workflows on a separate endpoint.

## Enable the Jarvis REST handshake in staging

The code is deliberately fail-closed until the real Jarvis service and four staging credentials are supplied through GitHub Actions/environment secret stores:

| Setting | Purpose |
|---|---|
| `JARVIS_STAGING_BASE_URL` | HTTPS Jarvis staging origin |
| `JARVIS_STAGING_API_TOKEN` | RyanAI outbound bearer token for Jarvis |
| `RYANAI_STAGING_API_BASE_URL` | HTTPS RyanAI staging API origin |
| `JARVIS_STAGING_INGRESS_TOKEN` | Separate bearer token Jarvis uses for RyanAI patch ingress |

On RyanAI staging only, configure `JARVIS_PATCH_INGRESS_ENABLED=true` and `JARVIS_INGRESS_TOKEN` to the same dedicated ingress secret. Keep production sync disabled. Run the repository's manual **Jarvis Staging Bridge Smoke** workflow first with optional patch and stack submissions disabled. Only enable the harmless staging candidate and staging manifest steps after the authenticated baseline succeeds. Do not copy secrets into chat, commits, workflow output, or PR comments.

A local contract test is not a live Jarvis handshake. The integration remains **configured-but-unverified** until the workflow returns a successful authenticated round trip to the actual Jarvis and RyanAI staging services.

## TorchTPU and model serving

TorchTPU is a native PyTorch backend for Google TPU hardware. It is not a model, a standalone HTTP server, or a drop-in replacement for NVIDIA GPUs. To use it from RyanAI, deploy a compatible serving runtime (for example a supported vLLM/SGLang TorchTPU build) that exposes an OpenAI-compatible `/v1/chat/completions` endpoint. RyanAI's MCP manager can then route a request to that separately managed endpoint using `brain: "torch_tpu"`.

Configure server-side only:

```dotenv
TORCHTPU_API_ENDPOINT=https://your-tpu-serving.example/v1
TORCHTPU_MODEL=your-served-model-id
TORCHTPU_API_KEY=your-serving-bearer-key
```

For a local endpoint, the loopback default is `http://127.0.0.1:8000/v1`; a model ID is mandatory. Remote endpoints require HTTPS and a bearer key. The optional TorchTPU route does not change the NVIDIA/Qwen/Logic three-brain orchestration or claim that TPU hardware exists. It is an additional model-serving target for explicit MCP calls.

The InfoQ article reports TorchTPU's eager and compiled execution modes and Google-reported performance figures on specific TPU workloads. Its DeferAndFuse performance comparison is not a RyanAI benchmark. Dynamic shapes, compilation latency, operator coverage and quantization remain active maturity areas; verify the exact model/runtime/TPU generation before workload migration.

## Operational boundaries

- No cloud deployment, public gateway exposure, production sync, production patch ingress, production stack publication, container publication, database migration, secret rotation, paid upgrade, or release is performed by this integration.
- Jarvis patch ingress must stay disabled until the actual staging endpoints and separate ingress token are configured.
- MCPJungle is an optional local profile, not a requirement for RyanAI startup.
- Use a dedicated MCPJungle client identity for Jarvis and an explicit upstream allow-list. Never use wildcard server access for the Jarvis client.
- Require human review and passing CI/security checks before any patch is merged.

## References

- MCPJungle repository and MPL-2.0 license: https://github.com/mcpjungle/MCPJungle
- MCPJungle enterprise deployment: https://docs.mcpjungle.com/deployment/production
- MCPJungle client access control: https://docs.mcpjungle.com/governance/access-control
- MCPJungle tool groups: https://docs.mcpjungle.com/guides/tool-groups
- TorchTPU InfoQ: https://www.infoq.com/news/2026/11/torchtpu-native-pythorch-tpu/
- Google TorchTPU announcement: https://cloud.google.com/blog/topics/ai-infrastructure/torchtpu-is-now-open-source-run-native-pytorch-on-tpus
