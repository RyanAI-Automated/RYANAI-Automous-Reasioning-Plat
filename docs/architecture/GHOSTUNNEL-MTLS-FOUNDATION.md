# Ghostunnel mTLS Foundation

**Status:** evaluation-only foundation  
**Pinned upstream release:** Ghostunnel v1.11.5  
**Runtime activation:** disabled  
**Production deployment:** not authorized by this change

## Decision

Adopt Ghostunnel as a candidate mutual-TLS transport proxy for selected RyanAI service-to-service links. Do not install it as a blanket network layer and do not equate possession of a workload certificate with permission to perform an application action.

Ghostunnel supports client and server proxy modes, mutual TLS, certificate-attribute and OPA-based peer checks, SPIFFE workload identities, certificate reload, and status/Prometheus metrics. Its server mode requires an explicit client-allow rule unless authentication is deliberately disabled. RyanAI must not disable that authentication.

Upstream release notes identify v1.11.5 (21 October 2026) as a security release. The candidate image is therefore pinned to `ghostunnel/ghostunnel:v1.11.5-distroless`; mutable `latest` tags are prohibited. Before any runtime rollout, verify the image digest, provenance, SBOM, signature/attestation availability, and vulnerability scan in CI.

## Why this is useful

- Authenticate both ends of selected internal connections.
- Encrypt traffic on links that currently rely on plaintext transport inside a trusted network.
- Reduce the need to modify legacy clients and services to add TLS support.
- Support short-lived workload credentials and controlled certificate rotation.
- Expose tunnel health and connection metrics for operational monitoring.
- Add a transport-level identity check that complements, but does not replace, Gen-X.

## Initial candidate links

Prioritise links only after mapping their actual callers, network namespaces, protocol behavior, and credential ownership:

1. API to PostgreSQL, where a staging-only pilot can prove certificate verification and migration compatibility.
2. API and worker traffic to internal MCP endpoints, after confirming the actual runtime call path.
3. Worker-to-worker or orchestration links only where a concrete untrusted-network or plaintext transport risk is demonstrated.

Redis, PostgreSQL, MCP, and API must not be assumed to share the same TLS configuration or health semantics. PostgreSQL's native TLS and Redis TLS should be compared against a proxy before selecting Ghostunnel. Avoid adding an extra proxy hop when native TLS is simpler and equally verifiable.

External HTTPS model-provider calls already use TLS at the application/client layer; do not insert Ghostunnel without a specific routing or identity requirement.

## Identity and authorization

- Prefer SPIFFE URI SAN workload identities issued by a trusted workload identity provider.
- Trust only the explicitly configured CA bundle or approved key pins.
- Require client certificates; reject missing, expired, untrusted, or incorrectly identified peers.
- Do not use `--allow-all`, `--disable-authentication`, or common-name-only identity as a production trust rule.
- Do not expose status/metrics endpoints publicly.
- Do not use unsafe listener/target overrides to bypass Ghostunnel's address protections.
- Never commit certificates, private keys, tokens, or populated environment files.

A successful mTLS handshake proves that the peer possesses an accepted workload identity. It does **not** authorize that peer to read another user's data, invoke privileged MCP tools, access secrets, approve patches, merge code, or deploy. Gen-X and the application authorization layer remain authoritative and must fail closed independently.

## Rollout stages

### Stage 0 — contract and threat-model baseline

This PR adds a machine-readable contract and automated validator. Ghostunnel remains evaluation-only and is not wired into Docker Compose, Render, Vercel, or production traffic.

### Stage 1 — isolated staging pilot

Requires a separately approved staging target and an approved certificate issuer/trust-bundle design. Use synthetic data and a dedicated service identity. Do not reuse production keys or trust roots.

The pilot must demonstrate:
- Successful client/server mutual TLS handshake for the intended SPIFFE identities.
- Rejection of no certificate, unknown identity, wrong CA, expired certificate, and revoked/replaced trust.
- No public listener or published host port for tunnel internals.
- Certificate rotation and expiry monitoring without application downtime.
- Correct application protocol behavior, connection pooling, timeout behavior, graceful shutdown, and health reporting.
- Measured p50/p95 latency, CPU, memory, connection count, and failure rate against a no-proxy baseline.
- Redacted logs and observable tunnel metrics.
- Tested rollback to the previous verified transport configuration.

### Stage 2 — limited service rollout

Only after Stage 1 passes and a human approves the exact service, image digest, certificate identity, CA, network topology, resource limits, and rollback procedure. Roll out one connection class at a time. Keep a known-good configuration and a fast, tested rollback.

### Stage 3 — broader adoption decision

Compare Ghostunnel against native TLS for each service. Expand only where measured security and operational benefit exceeds latency, resource, certificate-lifecycle, and maintenance costs.

## Operational prerequisites

- A supported certificate issuer or SPIFFE Workload API with clear ownership and availability objectives.
- Separate staging and production trust roots and identities.
- Protected, read-only certificate mounts or workload API access; private keys must not enter Git or container images.
- Rotation, expiry, revocation/trust-bundle replacement, and emergency recovery runbooks.
- Network policy preventing direct access to a backend where the proxy is intended to be mandatory.
- Metrics and alerts for handshake failures, certificate expiry, tunnel restarts, connection saturation, and backend failures.
- A documented owner for image updates, CVE response, and release pin changes.

## Validation

Run:

```bash
npm run ghostunnel:validate
npm run test:ghostunnel
```

These checks validate the repository policy contract only. They do not prove that Ghostunnel is installed, that certificates exist, that mTLS is active, or that any live connection is protected.

## Upstream references

- [Ghostunnel project and usage](https://github.com/ghostunnel/ghostunnel)
- [Ghostunnel releases](https://ghostunnel.dev/releases/)
- [Docker image documentation](https://ghostunnel.dev/docs/deployment/docker/)
- [Ghostunnel quick start](https://ghostunnel.dev/docs/getting-started/quickstart/)
