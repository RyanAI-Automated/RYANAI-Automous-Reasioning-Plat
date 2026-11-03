# RyanAI Cloudflare MCP Integration and Edge Security

## Purpose

Connect Cloudflare's managed MCP capabilities to RyanAI through a governed integration path. Cloudflare must not become a second, unmanaged agent gateway. MCPJungle remains the single upstream registry/proxy for agents; Cloudflare supplies edge access control, tunnel connectivity, WAF/rate controls, and Cloudflare account operations through its managed MCP service.

## Cloudflare MCP endpoints

Use Streamable HTTP endpoints:

- Cloudflare API MCP: `https://mcp.cloudflare.com/mcp` (preferred for account operations; Code Mode minimizes tool-context overhead).
- Cloudflare documentation MCP: `https://docs.mcp.cloudflare.com/mcp` (read-only documentation discovery).
- Cloudflare Agents SDK docs: `https://agents.cloudflare.com/mcp` (read-only engineering reference).

Cloudflare recommends OAuth for direct MCP clients. Its API MCP can also accept a Cloudflare API token for automation. Create a dedicated token restricted to the required account and permissions; never use a Global API Key.

## Gateway compatibility constraint

MCPJungle distinguishes **upstream** authentication from **downstream client** authentication. Its current support matrix marks registration-time OAuth for upstream HTTP MCP servers as **beta** and gateway-scoped (not per downstream user). Enterprise-mode downstream clients authenticate with static bearer tokens; downstream OAuth, SSO and OIDC are not yet supported. Therefore:

1. Do not describe upstream OAuth as wholly unsupported: it is available as a beta registration-time flow and must be tested against the pinned 0.4.6 release before relying on it.
2. Do not assume Cloudflare OAuth authorization is passed through per RyanAI user. The upstream OAuth grant is gateway-scoped.
3. For a unified MCPJungle route, use a dedicated, least-privilege Cloudflare API token only after confirming how the pinned MCPJungle release protects stored upstream credentials and backups, or separately validate its beta upstream OAuth flow.
4. Until the credential-storage and OAuth tests pass, keep Cloudflare API access out of the gateway. Read-only Cloudflare documentation can be evaluated separately.
5. Cloudflare Access remains an edge policy; MCPJungle downstream bearer-token authentication and per-client server allow-lists must remain enabled.

## Domain and hostname

The owner selected `ryanai.dev`; the intended gateway hostname is `mcp.ryanai.dev`. A registrar availability result is not a registration or proof of ownership. The domain has not been purchased, transferred, or added to Cloudflare. Do not create DNS or Tunnel routes until the owner separately authorizes registration/Cloudflare account changes and confirms the domain is active in the Cloudflare zone.

## Proposed service topology

```text
RyanAI agents / Jarvis
        |
        | per-client MCPJungle token + tool-group allowlist
        v
Cloudflare Tunnel (outbound connector; no inbound origin port)
        |
Cloudflare Access policy + WAF / rate limits
        |
        v
MCPJungle Streamable HTTP gateway (/mcp)
        |
        +--> RyanAI MCP server (private Docker network)
        |
        +--> Cloudflare API MCP (dedicated scoped bearer token; gated)
        +--> Cloudflare Docs MCP (read-only)
        +--> approved future upstreams
```

Cloudflare Tunnel and Access are the required edge path for the cloud-first gateway. The repository Compose file now has an opt-in `cloudflared` connector under the `cloudflare-edge` profile. It joins the private Docker network, has no published host port, and forwards through the named Tunnel. Configure the Tunnel's public hostname route for `mcp.ryanai.dev` to `http://mcpjungle:8080`; do not point it at a host-published port or expose MCPJungle directly.

Require both Cloudflare Access and the MCPJungle client token. For non-interactive agents, issue a distinct Cloudflare Access service token per agent and keep its client ID/secret in that agent's secret store; the agent must also send its individual MCPJungle bearer token. For human operators, use an approved identity-provider Access policy. Do not enable Access Managed OAuth for this MCPJungle origin unless the origin is updated to validate the Access JWT as Cloudflare requires. Access edge enforcement is not a substitute for MCPJungle tool authorization.

## Cloudflare API token policy

Start with read-only access only. Restrict resources to the exact Cloudflare account and zone RyanAI needs. Do not grant DNS edit, Workers deploy, account member, zone settings write, firewall write, or billing permissions for initial discovery.

If later approved write operations are needed, create a separate token for a narrowly defined change set and use explicit human approval. Do not expand the read-only token. Never put Cloudflare credentials in frontend variables, source code, Docker build arguments, committed Compose files, logs, or agent prompts.

## Registration and activation sequence

1. Confirm the pinned MCPJungle version and inspect its upstream credential storage, database encryption, backup, access-control, and audit behavior.
2. After the owner has separately registered `ryanai.dev` and added it to the Cloudflare zone, create a named Tunnel and a published-application route for `mcp.ryanai.dev`, targeting `http://mcpjungle:8080` on the private Docker network. Do not create a public origin IP or direct port-forward.
3. Create a Cloudflare Access application for that hostname. Add an operator identity policy and separate service-token policies for each non-interactive agent. Keep Access Managed OAuth disabled unless the origin validates Access JWTs.
4. Set `CLOUDFLARE_TUNNEL_TOKEN` in the private runtime environment/secret manager. Compose mounts this environment-backed secret as `/run/secrets/cloudflare_tunnel_token`, and cloudflared reads it using `--token-file`; the token is not passed as a command-line argument. Override the versioned development image default with a reviewed immutable `cloudflare/cloudflared` image digest before any shared/cloud activation. Do not put the token in source control, shell history, image build arguments, or process arguments.
5. Start MCPJungle, its dedicated PostgreSQL service, and the connector using both opt-in profiles: `docker compose --profile mcp-gateway --profile cloudflare-edge up -d mcpjungle-db mcpjungle cloudflared`.
6. Initialize the enterprise gateway from an authorized operator workstation; retain the admin credential in a secret manager.
7. Register RyanAI's local MCP server as a Streamable HTTP upstream. Verify it with a read-only `tools/list`.
8. Register Cloudflare Docs MCP as a read-only upstream and verify documentation lookup.
9. Register Cloudflare API MCP only after its token-storage gate passes. Begin with account/zone read-only permissions.
10. Create distinct MCPJungle clients for Jarvis, RyanAI runtime agents, and engineering automation. Assign separate server/tool groups; default deny. Give each remote agent its own Cloudflare Access service token as well as its MCPJungle token.
11. Run the acceptance checks below before declaring the service online.

The MCPJungle CLI's exact registration and enterprise-client syntax must be checked against the pinned release before running. Do not paste tokens into shell history or commit a generated MCPJungle config/database.

## Cloudflare edge engineering scope

- Tunnel: outbound-only connector from the private network; no public origin port.
- Access: explicit identity/service-token policies for approved MCP clients; short-lived/revocable credentials where supported.
- WAF and rate limiting: protect the public hostname against abusive traffic; set per-client and per-route limits.
- DNS/TLS: use a dedicated MCP hostname and managed TLS; enforce HTTPS.
- Observability: correlate Cloudflare request IDs with MCPJungle and RyanAI request IDs; redact Authorization headers and tool arguments containing secrets or personal data.
- Workers: use a Worker only when a specific edge transformation, auth integration, or routing requirement exists. Do not deploy a second MCP server merely to duplicate MCPJungle.
- Recovery: document tunnel restart, Access policy rollback, token revocation, database backup/restore, and gateway health checks.

## Acceptance criteria

- [ ] Cloudflare documentation MCP connects over Streamable HTTP and returns a real documentation result.
- [ ] Cloudflare API MCP authenticates with OAuth directly, or with a dedicated scoped API token through the reviewed gateway path.
- [ ] Read-only token cannot perform a write operation.
- [ ] MCPJungle upstream credential storage and backups have passed review before a token is stored there.
- [ ] Each agent has an individual gateway identity and explicitly assigned tool group.
- [ ] Anonymous and unauthorized requests are denied.
- [ ] Compose starts the `cloudflared` connector only when the `cloudflare-edge` profile is explicitly enabled; no host port is published for the connector.
- [ ] Tunnel token is delivered through an environment-backed Compose secret file and is not present in the process command line.
- [ ] Tunnel hostname routes to the private `mcpjungle:8080` service; no direct public origin port exists.
- [ ] Operator Access policy and per-agent service-token policies are tested; unauthenticated requests are denied.
- [ ] MCPJungle bearer-token authentication remains required after Cloudflare Access succeeds.
- [ ] Access Managed OAuth is not enabled unless MCPJungle validates the Access JWT.
- [ ] WAF and rate-limit policies are tested without locking out the operator.
- [ ] Logs include correlation IDs and redact credentials.
- [ ] Revocation of one agent credential does not affect other clients.

## Current status

The repository includes an opt-in cloudflared Compose connector that consumes its token through a Compose secret file and this activation runbook. The environment-backed Compose secret source requires Docker Compose v2.6.0 or later; the `--token-file` option requires cloudflared v2025.4.0 or later. This is implementation scaffolding, not proof that Cloudflare is connected: no domain registration, Cloudflare zone, Tunnel, DNS route, Access application, service token, or Cloudflare API credential has been provisioned. Those account-side actions require the account owner's authorization and Cloudflare dashboard access. The connector remains stopped unless both opt-in profiles are explicitly enabled and its runtime secrets are supplied.
