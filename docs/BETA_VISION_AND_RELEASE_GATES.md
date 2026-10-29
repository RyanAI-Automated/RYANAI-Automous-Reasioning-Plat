# RyanAI Beta Vision and Release Gates

**Status:** beta candidate plan; not a production certification  
**Last reviewed:** 2026-10-29

RyanAI should feel like an operator-grade autonomous reasoning platform: a calm, premium control room where people can understand system health, start work, inspect execution, and know when a result needs human review. Preserve the existing dark navy surface, cyan accents, clear typography, and compact cards. Prefer trustworthy operational signals over decorative metrics.

## Product experience

### 1. System dashboard
- Show API, database, cache, and checkpoint health as independent signals.
- Display the timestamp reported by the health API and make stale signals explicit.
- Keep unreported values as “Not reported”; never infer healthy from a missing field.
- Provide direct paths to the cockpit and workspace.
- Do not invent uptime, success-rate, latency, or active-task counts without instrumented sources.

### 2. Agent cockpit
- Submit a real authenticated reasoning request and show progress, result, and actionable errors.
- Keep model/provider availability separate from API reachability.
- For future long-running tasks, persist task IDs, lifecycle state, checkpoints, retries, and result artifacts before representing them as durable.
- Add approval gates before high-impact external actions; show the requested action and its scope before confirmation.

### 3. Workspace
- Preserve user-scoped conversation history and make the active conversation clear.
- Distinguish local-only history from server-persisted history when Supabase is not configured.
- Show tool activity only when it is returned by the execution path; do not label local UI state as a live integration.

### 4. Platform operations
- Add authenticated deployment, logs, traces, provider connectivity, and MCP inventory only when backed by real server endpoints.
- Keep credentials server-side. Never expose provider keys through browser-prefixed environment variables.
- Record security-relevant actions and enforce authorization server-side, not merely by hiding UI controls.

## Beta acceptance gates

A beta build should not be called production-ready until all applicable checks pass against the exact commit and deployed environment.

- [ ] Root and nested package install succeeds from committed lockfiles.
- [ ] TypeScript, lint, unit, stack, workflow, and client/server builds pass.
- [ ] Docker Compose builds and all expected health checks pass.
- [ ] Authenticated and unauthenticated routes behave correctly; account data remains user-scoped.
- [ ] Health timestamps are fresh; timeout, offline, missing-field, and stale states are visible.
- [ ] A real reasoning request succeeds with configured provider credentials and fails safely without them.
- [ ] MCP/Jarvis integrations are individually verified; configured endpoints and secrets are not assumed from code presence.
- [ ] Preview and production smoke tests pass against the actual public frontend and API URLs.
- [ ] Security review confirms CORS allowlists, rate limits, server-side authorization, secret handling, and approval gates.
- [ ] Release notes document known limitations and rollback instructions.

## Current known external blockers

- Vercel has previously returned a provisioning timeout, and a separate production deployment attempt was skipped. Re-check the provider's current deployment state before publishing.
- Vercel Hobby deployment quotas can prevent another deploy even when repository CI is green. Avoid repeated retries; wait for quota reset or use an authorized plan change.
- Render workflow success is not equivalent to a successful live API smoke test.
- External AI-provider, Supabase, MCP, Jarvis, Datadog, and other integrations require correctly configured credentials and live verification.

## Suggested delivery order

1. Reliable dashboard freshness and clear navigation.
2. End-to-end reasoning request with visible failure handling.
3. Persistent task lifecycle and observable execution.
4. Security review and integration-specific smoke tests.
5. Preview validation, production health check, release notes, and beta announcement.

This document is a scope and acceptance checklist. It does not claim that unverified external integrations or deployments are operational.
