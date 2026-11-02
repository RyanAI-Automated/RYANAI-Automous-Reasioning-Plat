---
name: grill-with-docs
description: Resolve material product, architecture and acceptance decisions before implementation, then record the shared domain language and decisions.
---

# Grill with docs

1. Read `AGENTS.md`, relevant source, tests, existing ADRs and recent PR context.
2. Restate the desired outcome in plain language. Separate requirements from examples and proposed solutions.
3. Map the decision tree: actors, workflows, inputs/outputs, state transitions, failure cases, permissions, data boundaries, dependencies, observability and rollback.
4. Identify only decisions that materially change the design. Ask them together in one concise interview. Reuse prior decisions; do not repeat answered questions.
5. For a long-running task, maintain a decision ledger with: decision, rationale, owner, date, evidence and whether reversible.
6. Produce a short spec with goals, non-goals, interfaces, acceptance tests, migration plan and rollout/rollback.
7. Begin implementation once material decisions are resolved. Check back only if new evidence changes the decision tree or a human approval is required.

Do not use grilling to delay obvious, reversible work. Do not implement while a material user-owned decision is unresolved. Do not interpret silence as approval for destructive or paid actions.
