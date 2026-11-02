# Durable queue execution planning

This change connects the shared targeted-execution planner to the existing PostgreSQL-backed `agent_runs` worker.

## Data flow

1. A trusted server-side dispatcher may persist a typed `executionScope` with the queued `agent_runs` row.
2. The queue claim query returns that scope in the same atomic `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING` claim.
3. The worker parses persisted JSON as untrusted data and calls `planQueuedAgentRun`.
4. Missing, malformed, unknown or unverified scope resolves to full reconciliation. Only explicitly known and fresh scope with valid resource keys can produce a targeted plan.
5. The selected plan is included in the reasoning prompt and persisted in the run result and memory record for later inspection.

## Conservative defaults

Existing dispatch call sites do not supply an execution scope. They therefore persist the empty JSON object and run full reconciliation. This PR does not infer resource scope from free-form user objectives and does not expose scope selection to public API clients. Future trusted server-side task types may pass a validated scope only after they have a source-of-truth event and a freshness check.

A targeted plan is a work-scope hint, not authorization. It does not grant filesystem, database, GitHub, deployment or external-action permissions. The RyanAI control plane and existing human approval boundaries remain authoritative.

## What this integration does and does not prove

It integrates the planner with the real durable queue and makes the decision durable and inspectable. It does not yet implement resource-specific execution adapters, database snapshot/version revalidation immediately before writes, queue coalescing, per-tenant fairness, lease fencing epochs, crash/restart integration tests, shadow comparison or rollback. Those are separate acceptance gates and must not be reported as complete.

The migration is additive: `agent_runs.execution_scope JSONB NOT NULL DEFAULT '{}'`. Existing rows remain valid and conservatively resolve to full reconciliation. No migration is applied to Supabase or any production database by this PR.
