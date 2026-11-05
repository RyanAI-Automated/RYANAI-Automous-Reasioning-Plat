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

## Neon database workflow
RyanAI uses Neon only in an explicitly selected environment and branch. The current approved audiobook staging target is:
- Project: `neon-byzantium-bucket` (`ancient-frost-85604914`)
- Region / PostgreSQL: `aws-us-east-1` / PostgreSQL 18
- Staging branch: `audiobook-staging` (`br-rapid-frog-bbi455gu`)

Rules:
- Use only the `audiobook-staging` branch for RyanAI audiobook schema, migration, fixture and integration-test work. The project's `main` branch is Vercel-managed; do not target it for application migrations, test writes, data imports, schema changes or cleanup.
- The staging branch is isolated from `main`, but it is not a substitute for a disposable test branch. Before each migration test that writes schema/data, create a short-lived child branch from `audiobook-staging`, run the test there, record the result, and clean up only after confirming the branch is disposable and no work needs preserving.
- Do not copy production data, secrets, personal data or real user audio into staging. Use synthetic or sanitized fixtures.
- Install project-level Neon tooling with Node.js 22.20 or newer (this repository declares Node.js 24.x): `npx neon@latest init -y --skill neon --mcp-auth oauth --mcp-config-location project --no-link --no-config`. This configures skills and the hosted MCP server without linking a database, writing a `neon.ts`, or pulling database credentials.
- After CLI authentication, link the workspace to the approved branch without writing credentials to dotenv files: `npx neon@latest link --project-id ancient-frost-85604914 --branch audiobook-staging --no-env-pull -y`. Keep the generated `.neon` context local and git-ignored. Never run `neon env pull` in this repository unless the user explicitly approves a secure secret-injection method.
- Use pooled `DATABASE_URL` for normal application traffic. Use the direct, unpooled connection for Prisma migrations, schema migration tooling, dumps/restores, logical replication and session-level operations. Keep TLS certificate verification enabled; never use `rejectUnauthorized: false`.
- Prefer read-only Neon diagnostics (`neon inspect db`) and schema diffs (`neon diff`) before and after migration work. Treat schema changes and data writes as staging-only unless a separately approved production change exists.
- Never commit connection strings, passwords, API keys, `.env`, `.env.local`, or `.neon`. Do not print secrets in logs, PRs, issues or handoffs. Use OAuth for interactive MCP access; use a project-scoped API key only for approved automation.
- Do not reset roles, rotate credentials, change Neon project settings, alter Neon Auth, create paid resources, deploy services, or modify the Vercel-managed `main` branch without explicit user approval.
- Before running destructive SQL, deleting branches, importing data, or applying migrations, explain the target branch, impact and rollback plan and obtain explicit approval. Never run schema/data mutations against `main`.

