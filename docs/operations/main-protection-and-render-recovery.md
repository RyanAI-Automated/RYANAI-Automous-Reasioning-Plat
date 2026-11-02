# Production main-branch protection gate

The active `main-protection` ruleset was inspected on 2026-11-02. It currently contains only Copilot code review; it does not require CI or security checks. Do not treat the ruleset's active state as proof of merge protection.

## Required policy

The repository administrator must update the existing `main-protection` ruleset (ID `26360956`) to require:

- Pull requests before updating `main`.
- At least one approving review, with stale approvals dismissed after new commits.
- Strict required status checks against the latest base commit.
- No routine bypass actors; retain only explicitly approved emergency access.
- No force pushes and no branch deletion.

## Required checks

Use the exact check-run context names emitted by the workflows on the current main commit. The guarded Render repair workflow requires these checks to be present and successful on the exact commit being deployed:

- `Validate (typecheck, lint, test, build)`
- `MCP server and workflow worker`
- `Issue 435 migrations and attachment security`
- `Test agent API contracts`
- `Dependency audit`
- `Trivy filesystem scan`
- `Analyze (javascript-typescript)`
- `Analyze (python)`
- `TruffleHog secret audit`
- `Codacy Security Scan`

If a workflow renames a check, update the policy and guarded workflow together. Never mark a missing, queued, failed, or skipped required security check as passing.

## Render API source repair

The existing Render API service is `srv-dbk4giu7bikc7394a4r0`. Its repository must be:

`https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`

The guarded workflow `.github/workflows/guarded-render-api-source-repair.yml` requires the exact current main SHA, all listed CI/security checks to succeed, the `RENDER_API_KEY` secret, and an explicit typed confirmation. It keeps Render auto-deploy disabled, updates the source, then explicitly requests one deploy. It does not alter environment variables, plans, databases, or secrets.

The Render API supports updating an existing service's `repo`, `branch`, and `autoDeployTrigger` fields through its Update Service endpoint. The workflow uses that endpoint rather than creating a duplicate service.
