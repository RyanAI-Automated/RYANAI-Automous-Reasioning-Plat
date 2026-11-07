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
