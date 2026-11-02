# RyanAI Engineering Contract

This repository uses an alignment-first, evidence-driven engineering workflow. These rules apply to Jarvis, RyanAI coding agents, human contributors, and delegated workers.

## Authority and safety
- RyanAI remains the permission and execution authority. Jarvis coordinates engineering; it does not grant itself permissions.
- Work in a scoped branch and isolated, disposable workspace. Never mount a developer home directory or production data into an agent sandbox.
- Never expose, copy, or log credentials. CI/agent identities must be least-privilege and short-lived where supported.
- Agents may propose code, migrations, PRs and plans. They must not merge, deploy, change secrets, provision paid resources, or apply production migrations.
- Human review and required CI/security checks remain mandatory. A PR, green unit test, or healthy process is not proof of end-to-end readiness.

## Alignment before implementation
For every non-trivial feature, bug fix, migration, or infrastructure change:
1. Inspect the relevant code, tests, architecture and current main commit before proposing edits.
2. Summarize the requested outcome, current behavior, constraints, non-goals and acceptance criteria.
3. Identify unresolved decisions, assumptions, dependencies, data/security impact and rollback.
4. Ask one consolidated set of material questions only where the answer changes implementation. Do not ask again for decisions already recorded.
5. When enough is known, record a concise spec/decision record and proceed. Do not turn every minor detail into a question.
6. Re-open alignment only when new evidence invalidates an assumption, scope materially changes, or a destructive/high-risk decision is required.

No implementation begins while a material, user-owned decision remains unresolved. If no such decision exists, state the assumptions and proceed.

## Engineering loop
- TDD: write a failing test for each meaningful behavior before implementation; demonstrate red, then green, then refactor.
- Bugs: reproduce, minimise, form a falsifiable hypothesis, instrument, fix, and add a regression test.
- Architecture: prefer deep modules and narrow interfaces; document durable domain terms and decisions.
- Review: review the diff against both repository standards and the agreed spec. Do not review only for style.
- Handoff: leave branch, commit, changed files, decisions, tests, evidence, risks and next action.
- PRs must state scope, tests/evidence, migration and rollback risks, and explicit non-goals.

## Evidence and reporting
Report only commands actually run and results actually observed. Distinguish implemented, locally tested, CI-passed, reviewed, merged, deployed and runtime-verified states. A skipped test is not a pass. A configured provider is not authenticated. Never manufacture success evidence.
