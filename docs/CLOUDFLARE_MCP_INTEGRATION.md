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

The currently pinned MCPJungle gateway is configured for Streamable HTTP upstreams and static bearer-token forwarding. Its published documentation states OAuth upstream flows are not supported yet. Therefore:

1. Do not assume Cloudflare OAuth can be passed through MCPJungle.
2. For a unified MCPJungle route, use a dedicated, least-privilege Cloudflare API token only after confirming how the pinned MCPJungle release protects stored upstream credentials and backups.
3. Until that storage review is accepted, connect to Cloudflare's managed MCP endpoint directly with OAuth from a trusted engineering client for read-only documentation and inspection. Do not route Cloudflare account write access through MCPJungle yet.
4. Revisit gateway OAuth support before moving to per-user Cloudflare authorization.

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

Cloudflare Tunnel and Access are the preferred edge path when a shared remote gateway is approved. Keep the origin service private; do not publish MCPJungle's Docker port directly to the public internet. Require both the Cloudflare Access identity check and the MCPJungle client token. These are separate security layers, not substitutes.

## Cloudflare API token policy

Start with read-only access only. Restrict resources to the exact Cloudflare account and zone RyanAI needs. Do not grant DNS edit, Workers deploy, account member, zone settings write, firewall write, or billing permissions for initial discovery.

If later approved write operations are needed, create a separate token for a narrowly defined change set and use explicit human approval. Do not expand the read-only token. Never put Cloudflare credentials in frontend variables, source code, Docker build arguments, committed Compose files, logs, or agent prompts.

## Registration and activation sequence

1. Confirm the pinned MCPJungle version and inspect its upstream credential storage, database encryption, backup, access-control, and audit behavior.
2. Start MCPJungle and its dedicated PostgreSQL service only in the local `mcp-gateway` profile. Keep both bound to loopback until security review passes.
3. Initialize the enterprise gateway from an authorized operator workstation; retain the admin credential in a secret manager.
4. Register RyanAI's local MCP server as a Streamable HTTP upstream. Verify it with a read-only `tools/list`.
5. Register Cloudflare Docs MCP as a read-only upstream and verify documentation lookup.
6. Register Cloudflare API MCP only after its token-storage gate passes. Begin with account/zone read-only permissions.
7. Create distinct MCP clients for Jarvis, RyanAI runtime agents, and engineering automation. Assign separate server/tool groups; default deny.
8. Put the gateway behind Cloudflare Tunnel and Access only after origin authentication and client-token enforcement are verified.
9. Run the acceptance checks below before declaring the service online.

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
- [ ] Tunnel exposes no direct public origin port.
- [ ] Access and WAF policies are tested without locking out the operator.
- [ ] Logs include correlation IDs and redact credentials.
- [ ] Revocation of one agent credential does not affect other clients.

## Current status

This document defines the implementation strategy and acceptance gates. It does not claim that Cloudflare is connected, that a Cloudflare token exists, that a Tunnel or Access application has been provisioned, or that any Cloudflare resource has been changed. Those steps require the account owner's authorization and credentials.
