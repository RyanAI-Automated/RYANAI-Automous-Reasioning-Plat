# Agent task board and MCP integration

**Status:** initial frontend/API/MCP vertical slice on a feature branch; not deployed or enabled in production.

## Decision

RyanAI owns its production task board and PostgreSQL records. The implementation adopts Kanzo's useful human/agent workflow—shared task visibility and durable progress comments—without embedding Kanzo's executable or treating its local SQLite database as RyanAI's system of record.

Kanzo is a standalone local application and MCP server. Its default listener is loopback; network sharing has no login layer. Its AGPL-3.0 license also requires source disclosure when a modified version is offered over a network. Keep Kanzo as an optional local developer tool unless a separate security and licensing review approves another deployment model.

Upstream: https://github.com/emanuele-em/kanzo

## Current vertical slice

### Frontend

The authenticated admin-only **Agent Tasks** route provides:

- Four execution columns: To do, Doing, Completed, and Blocked, plus a Cancelled column.
- Task creation through the existing durable Jarvis queue.
- Worker handoff visibility from persisted PostgreSQL records.
- Progress comments, displayed from the hash-chained evidence ledger.
- Eight-second refresh from the API; no fabricated progress or optimistic status changes.

Task status is intentionally not draggable or manually editable. The queue worker owns claim, lease, retry, completion, and failure transitions. A completed execution is not automatically accepted: approval, CI evidence, independent evaluation, and assurance gates remain separate.

### Backend

The board reuses existing agent_runs, agent_handoffs, agent_run_evidence, and jarvis_audit_events records.

- GET /api/jarvis/internal/tasks lists the authenticated administrator's tasks and ordered evidence.
- POST /api/jarvis/internal/tasks/:taskId/comments writes a comment and audit event in one transaction.
- Comment text is bounded and screened for common credential patterns.
- Task comments are appended through the existing row-locked, SHA-256 hash-chained evidence writer.

No new database table or migration is introduced by this slice.

### MCP adapter

The existing MCP manager exposes two additional tools only when its task API URL and dedicated token are configured:

- agent_tasks_list — read tasks for the configured agent principal.
- agent_task_comment — append an auditable progress comment.

The tools remain disabled by default and still require explicit inclusion in RYANAI_MCP_ENABLED_TOOLS. They cannot claim work, alter worker-owned task status, approve privileged actions, modify source code, merge pull requests, or deploy.

The backend machine-ingress routes are separately gated and use a dedicated bearer token, not the admin session token or the MCP HTTP listener token. The configured agent identity and owner UUID are server-side values; clients cannot choose either.

## Opt-in configuration

Configure these only in the relevant secret/environment manager after review. Do not commit values to the repository.

API service:

- JARVIS_TASK_INGRESS_ENABLED=true
- JARVIS_TASK_INGRESS_TOKEN — dedicated random secret of at least 32 characters
- JARVIS_TASK_AGENT_ID — stable identity for this MCP runtime
- JARVIS_TASK_OWNER_ID — UUID of the RyanAI account whose tasks this runtime may read/comment on

MCP manager:

- RYANAI_TASKS_API_URL — API origin, preferably HTTPS for remote use; loopback is permitted for local development
- RYANAI_TASKS_API_TOKEN — same dedicated task-ingress secret
- RYANAI_MCP_ENABLED_TOOLS=agent_tasks_list,agent_task_comment

Keep MCP_AUTH_TOKEN separate. It protects access to the MCP HTTP listener and is not the API task-ingress credential. For a non-loopback MCP listener, retain a strong listener token and an explicit host/origin allowlist. Do not expose an unauthenticated listener to the public internet.

If any API ingress setting is missing, the task-agent endpoints fail closed. If the MCP URL or token is absent/invalid, the two task tools are not registered. No production environment variables have been changed as part of this code change.

## Remaining work before production activation

1. Run the frontend TypeScript build, lint, route checks, MCP syntax checks, and MCP tool-registry tests.
2. Add API integration tests for owner isolation, disabled ingress, wrong token, secret rejection, evidence-chain validity, and comment audit atomicity.
3. Add browser tests for board loading, queue submission, comment submission, empty/error states, and role gating.
4. Decide whether agents need a true atomic claim/lease API. Do not let MCP agents race the existing queue worker; a claim API requires a coordinated worker/lease design.
5. Decide whether a human-managed backlog should be a separate persisted state. Do not emulate backlog by setting agent_runs.status to an unknown value because that could break worker recovery.
6. Complete the AGPL-3.0 review before distributing or modifying Kanzo as a network service.
7. Enable the scoped ingress only after CI passes and an operator provisions the dedicated credentials.

## Acceptance and release boundaries

- PostgreSQL remains the durable source of truth; Redis is coordination only.
- The existing worker retains authority over queue status and leases.
- Human approval and required CI/security checks remain mandatory.
- No self-merge, auto-deploy, production migration, secret write, or paid infrastructure change is part of this work.
- A green PR check is required before merge; production activation is a separate approved operation.
