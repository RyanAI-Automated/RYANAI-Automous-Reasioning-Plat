# RyanAI Plugin & Integrations Centre

## Purpose

The Settings page exposes a discoverable catalogue of integrations relevant to the PA Agent, workforce, workflows, Agentic Communications, knowledge retrieval, engineering and research.

## Current implementation boundary

The first UI increment stores only user-owned preferences in Supabase Auth metadata under `ryanai_plugin_preferences`. It does not install an integration, create a provider connection, store credentials, register runtime tools, or grant a worker permission to execute a tool. The UI labels every catalogue entry **Adapter required** to avoid representing a proposed connector as operational.

Provider credentials must remain in the server-side secret/configuration boundary and must never be copied into user metadata or browser storage. User preferences cannot grant roles, OAuth scopes, provider access or execution rights.

## Required integration lifecycle

1. **Discover:** catalogue a provider, its supported capabilities, owner, data classification and adapter status.
2. **Review:** assess terms, security posture, OAuth scopes, webhook verification, data retention and outbound-action risk.
3. **Connect:** perform provider OAuth or credential provisioning through a server-side flow. Never expose refresh tokens or secrets to the browser.
4. **Authorize:** bind the connection to a verified user/workspace and an explicit least-privilege policy. User preference is not authorization.
5. **Register:** expose tools through the governed MCP/tool registry with stable schemas, ownership, risk labels and default-deny enablement.
6. **Test:** contract tests, mocked provider tests, auth/scope tests, tenant-isolation tests, rate-limit/retry tests, audit tests and failure/revocation tests.
7. **Release:** exact-head CI and security checks must pass; require human review. Do not auto-merge.

## Workforce and module scopes

The UI catalogue records intended consumers such as PA Agent, Comms workers, scheduling workers, knowledge workers, engineering workers and the workflow engine. Runtime enforcement must be implemented server-side; client-side toggles are never an enforcement boundary.

## Communications and high-impact actions

Outbound email, WhatsApp, SMS and voice dispatch must retain the existing human-review checkpoint. Drafting and dispatch are separate capabilities. No connector may bypass approval, send a message during a test, or treat a successful draft as a delivered message.

Financial transactions, brokerage actions, production infrastructure changes, production database migrations and secret rotation remain outside this UI increment and require their own explicit approvals.

## Validation plan

- Verify Settings renders the catalogue on mobile and desktop.
- Verify search and category filters.
- Verify owner/admin visibility restrictions.
- Verify preferences are persisted only after matching the authenticated Supabase user ID.
- Verify malformed preference metadata is normalized safely.
- Verify the component never claims a provider is connected or installed.
- Add adapter-level test suites separately for each provider before enabling runtime use.

## Server registry foundation

The server-side registry foundation is introduced in `src/server/plugins/`:

- `pluginRegistry.ts` defines validated provider manifests, capability risk labels, adapter contracts and an in-process registry.
- `pluginCatalog.ts` seeds the provider catalogue used by the API.
- `routes.ts` exposes the authenticated, read-only `GET /api/plugins/registry` endpoint.
- The API authentication hook requires a verified Supabase user for plugin registry routes.

The registry reports only `adapter_required` or `adapter_registered`. It does not report a provider as connected or healthy: those states require a later connection lifecycle and live provider verification. Registered adapter objects remain private to the server process; public catalogue methods expose metadata only.

Adapter implementations receive an opaque server-side `connectionRef`, never raw browser-supplied credentials. This contract does not yet provide an invocation endpoint or execution service. The next increment must add provider connection ownership, OAuth state/PKCE, encrypted token storage, scope validation, revocation and a Gen-X authorization decision before any adapter can execute.

## Initial API contract

`GET /api/plugins/registry` returns a `providers` array containing provider IDs, display names, categories, manifest versions, declared capabilities, capability risk labels, human-approval requirements, data classifications and adapter registration status. The route requires a verified user and never returns tokens, secrets, connection records or executable adapter instances.

## Non-goals for this increment

- No OAuth flows or provider credentials.
- No live provider adapter implementations.
- No workflow dispatch, PA Agent tool execution or outbound communications.
- No database schema change or migration.
- No production deployment or infrastructure change.

## Secure provider authorization foundation

The authorization foundation in `src/server/plugins/providerAuthorization.ts` provides:

- AES-256-GCM credential encryption with random 96-bit nonces, authentication tags and provider/owner-specific additional authenticated data.
- A fail-closed 32-byte hex key parser. No key is generated, stored in repository settings or provisioned by this change.
- Short-lived OAuth transactions with high-entropy state, SHA-256 state hashes, PKCE S256 challenges and encrypted code verifiers.
- HTTPS-only authorization and redirect URL validation.
- Requested/granted scope intersection, provider allowlists and mandatory-scope enforcement.
- Owner/provider binding checks and explicit provider-confirmed revocation state transitions.
- Encryption helpers for access and refresh tokens that bind ciphertext to the provider and owning RyanAI user.

The accompanying Prisma migration and schema models introduce server-only provider connection records, one-use OAuth state records and append-only authorization lifecycle events. Browser roles `anon` and `authenticated` are explicitly revoked from these tables; server access remains subject to authenticated owner checks. The migration is code only and has not been applied to any database.

### Important implementation boundary

This increment is a security foundation, not a complete live OAuth connection flow. It does not register provider client IDs/secrets, create or rotate credentials, exchange provider authorization codes, refresh tokens, call provider revocation endpoints or mark a provider connected. Those operations require provider-specific adapters, owner-authorized server configuration, live callback verification and dedicated integration tests. Until then, providers remain disconnected/adapter-required in the UI.

Never log OAuth codes, raw state, PKCE verifiers, access/refresh tokens, client secrets or encryption keys. Authorization events may contain only redacted lifecycle metadata.
