# Targeted execution reliability

**Status:** engineering contract and deterministic planner/equivalence primitive. Runtime integration and the end-to-end acceptance gates remain outstanding.

## Guiding rule

> Optimize the amount of work, never the amount of certainty.

RyanAI should choose the smallest execution scope it can prove correct. Uncertainty must increase work, never silently reduce it. This policy applies across the durable task queue, agent workspaces, Jarvis, database workflows, backups, maintenance and future automation.

## Execution scopes

The shared planner in `src/agent/executionPlanner.ts` models four outcomes:

- **Targeted:** rebuild only identified resources when the event is known and the execution snapshot is fresh.
- **Targeted with metadata:** rebuild identified resources and their shared metadata together.
- **Purge:** remove a resource only when the event and current snapshot are both verified.
- **Full reconciliation:** required for unknown events, stale snapshots, malformed or missing resource scope, or changes that may affect an entire subsystem.

The planner is deliberately conservative. It does not authorize writes, establish ownership, or replace transaction-level checks. Every worker must revalidate task ownership, actor permissions, resource version and relevant dependencies immediately before committing output.

## Equivalence contract

A targeted execution is acceptable only when the output it owns is byte-for-byte equivalent to the same keys from a full execution over the same pinned input snapshot. The comparison must reject duplicate keys, missing expected keys, changed values and writes outside the declared target scope.

The pure helper `areOwnedOutputsEquivalent` provides a deterministic primitive for this contract. It is not a substitute for integration tests against the real persistence and execution paths.

## Scheduler and recovery contract

The production scheduler must preserve these invariants:

1. Persist task intent and audit metadata before notifying workers.
2. Claim work atomically; never allow two live workers to own the same lease.
3. Fence stale workers from writing after ownership changes.
4. Coalesce compatible queued work only when the union is a safe superset of every input request.
5. A full reconciliation dominates targeted work; purge dominates rebuild only when a fresh, authorized desired state proves removal.
6. Keep task completion and acknowledgement separate from in-memory worker completion. Acknowledge only after durable result persistence.
7. Recover expired leases with bounded retries and backoff; exhausted work fails visibly.
8. Enforce per-tenant fairness, bounded concurrency, cancellation and resource limits.
9. Revalidate permissions and fresh state immediately before side effects.
10. Record scope, input version, output version, attempt, worker/lease identity and evidence for every run.

## Six acceptance gates

| Gate | Required evidence |
|---|---|
| Planner classification | Unit and property tests cover known/unknown events, scope mapping, shared metadata, purge, malformed input and escalation. |
| Execution equivalence | Targeted and full execution run against the same immutable fixture/snapshot; all owned outputs compare byte-for-byte. |
| Fresh-state safety | Integration tests change permissions, task version, resource ownership and dependencies between planning and commit; stale writes are rejected. |
| Scheduler behavior | PostgreSQL-backed tests cover compatible coalescing, full-scope dominance, retry, fairness, cancellation and concurrent claims. |
| Crash recovery | Kill/restart tests cover crashes before claim, during work, after output write and before acknowledgement; no lost task or stale write. |
| Shadow and rollback | A shadow worker compares outputs without serving users; persistent diffs alert; staged rollout and rollback are demonstrated on a disposable environment. |

A unit test or a green PR does not satisfy runtime gates. Report each gate as not started, implemented, locally tested, CI-passed, runtime-verified or accepted, with evidence tied to a commit and environment.

## Rollout sequence

1. Land the pure policy and deterministic tests without changing production execution behavior.
2. Instrument existing agent-run and scheduled-task paths to record planned scope, snapshot version, lease and result metadata.
3. Integrate planner decisions into one bounded execution path behind a disabled-by-default feature flag.
4. Add PostgreSQL concurrency, stale-state, cancellation and crash/restart integration tests using disposable CI databases only.
5. Run a shadow executor against synthetic or approved sanitized workloads. Compare targeted output with the established full path.
6. Investigate all persistent differences; never waive unknown mismatches to improve performance.
7. Gradually enable by stable tenant/task cohort with a kill switch and verified rollback.
8. Extend the same contract to backup verification, DB preview lifecycle, maintenance and other workstreams.

## Cross-workstream ownership

- **Durable execution and sandbox:** scheduler, leases, worker isolation, cancellation, resource bounds and crash recovery.
- **Database isolation (#703):** isolated schema/migration tests and disposable fixtures; no production fallback.
- **Startup backups (#702):** backups must not block API readiness; upload integrity and restore drills are separate from process health.
- **Jarvis:** coordinates work and reports evidence; it cannot grant permissions or approve its own changes.
- **RyanAI control plane:** remains the authority for scopes, permissions, human approvals and production promotion.

## Safety and non-goals

This change does not enable targeted execution in production, alter the queue schema, run migrations, create Supabase branches, change secrets, enable backups, provision paid infrastructure, merge PRs or deploy services. No agent may autonomously merge, deploy, rotate secrets or apply production migrations.
