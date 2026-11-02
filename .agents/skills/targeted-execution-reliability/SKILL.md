---
name: targeted-execution-reliability
description: Plan the smallest provably safe execution scope and require equivalence, fresh-state, scheduler, recovery and shadow evidence.
---

# Targeted execution reliability

Apply this discipline to every RyanAI workstream, not only Jarvis.

1. Identify the event, affected resources, shared metadata, ownership boundary and immutable input version.
2. Use `src/agent/executionPlanner.ts` as the conservative scope-classification reference.
3. Unknown event semantics, stale snapshots, malformed scope or unbounded effects escalate to full reconciliation.
4. Revalidate actor permissions, resource ownership, task version and dependencies immediately before writes. Planning is not authorization.
5. Compare targeted outputs byte-for-byte with a full baseline from the same snapshot.
6. Coalesce only compatible work; the union must preserve every requested outcome. Full work dominates targeted work. Purge requires fresh, authorized desired state.
7. Test concurrent claims, lease fencing, retries, fairness, cancellation and worker restart against disposable infrastructure.
8. Shadow before rollout, investigate persistent diffs, and keep a tested kill switch and rollback.
9. Report evidence by exact commit and environment. Never describe a unit test as runtime verification.

See `docs/targeted-execution-reliability.md` for the six acceptance gates and rollout contract. RyanAI remains the permission and execution authority; Jarvis coordinates but cannot approve or promote its own work.
