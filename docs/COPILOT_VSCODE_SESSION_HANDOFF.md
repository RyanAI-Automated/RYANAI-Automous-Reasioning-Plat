# RyanAI standard: VS Code ↔ GitHub Copilot App engineering handoff

**Status:** repository workflow standard; cross-app live-session transfer is capability-gated and must not be assumed.

## Purpose

Use VS Code as the normal engineering starting point, move suitable implementation work to the GitHub Copilot App when the app can attach to the same repository/branch and accept the handoff context, then return to VS Code for final inspection, local verification and PR delivery.

The GitHub tutorial supplied for this change documents **Copilot App → VS Code** session continuation. It does not establish the reverse direction (**VS Code → Copilot App**) or guarantee that a VS Code chat transcript, local worktree, uncommitted changes or agent state can be imported into the app. Therefore RyanAI standardizes the engineering handoff and evidence contract, not an unsupported claim of bidirectional session migration.

## Required invariants

1. **One task, one feature branch, one authoritative worktree at a time.** Record the repository, branch, worktree path/identity and exact base/head commit SHAs.
2. **No implicit session transfer.** Only describe a conversation, diff or worktree as transferred when the product visibly confirms it. Otherwise create a concise handoff summary and explicitly start a continuation session.
3. **No parallel competing edits.** Before changing environments, ensure the prior agent is paused. On return, inspect both worktree status and remote branch state; reconcile rather than overwrite.
4. **Isolation.** Use an isolated, disposable worktree for agent edits. Do not expose a developer home directory, production data, secret stores or broad host credentials. Network and process access must follow the repository's sandbox policy.
5. **Approval remains authoritative.** RyanAI's authenticated workbench approval is bound to the task plan, base commit and proposed diff. A Copilot session does not grant or inherit approval for a changed plan/diff. Revalidate approval whenever the approved plan, base or diff changes.
6. **No agent self-approval or privileged actions.** Copilot may propose changes and prepare a branch/PR. It must not merge, deploy, change secrets, provision paid resources, run production migrations or perform live broker actions.
7. **Evidence is exact-head evidence.** Tests and security checks must identify the commit they tested. Queued, skipped, cancelled, mocked, human-reported or stale checks are not CI passes.
8. **Human review is mandatory.** The final PR diff, required CI/security results and risk notes must be reviewed before merge.

## Standard operating procedure

### A. Start in VS Code

1. Open the official RyanAI repository and confirm the intended feature branch. Do not work directly on `main`.
2. Create or reuse a dedicated isolated worktree for the task.
3. Read `AGENTS.md`, relevant architecture docs, the issue/PR and existing changes.
4. Record the task objective, non-goals, acceptance criteria, base SHA, branch and worktree identity.
5. Ask Copilot to inspect and plan first. Do not allow implementation to expand beyond the approved scope.

### B. Prepare the portable handoff

1. Pause the VS Code agent before switching environments.
2. Save all intended changes in the same feature worktree; record whether the worktree is clean or contains uncommitted changes. Do not commit merely to make a handoff unless the task's normal review process calls for it.
3. Complete the handoff template below. Include a concise summary of relevant conversation decisions rather than assuming the other product can read the original chat.
4. Redact secrets, tokens, private personal data and unrelated conversation content.
5. Confirm the Copilot App can open or attach to the same repository and branch/worktree. If it cannot, do not create a second competing checkout: continue in VS Code.

### C. Continue in the Copilot App only when supported

1. Start/continue a session against the exact repository and feature branch exposed by the app.
2. Supply the handoff record and ask the agent to restate the objective, constraints, base SHA, current diff and next action before editing.
3. Confirm the session is operating on the expected branch and files. If the app creates a different checkout or branch, stop and reconcile deliberately.
4. Keep the work focused. Do not authorize new permissions or privileged actions through the prompt.

### D. Return to VS Code

1. Pause the Copilot App agent and record its final handoff summary.
2. Reopen the original worktree in VS Code.
3. Verify `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, and `git diff` (including staged changes).
4. Compare the local branch with its upstream and inspect the complete diff. If the app worked in another checkout, fetch and review that branch; do not copy files blindly.
5. Reconcile conflicts and ensure no changes were lost or duplicated.

### E. Verify and deliver

1. Run relevant tests, lint/type checks and build checks locally; record exact commands and outcomes.
2. Push only the approved feature branch.
3. Open or update a reviewable PR against `main`. Include the base/head SHA, summary, changed files, tests, security considerations, migration/deployment impact and rollback notes.
4. Wait for required CI and security checks to complete against the exact PR head SHA.
5. Obtain human review. Do not auto-merge, deploy or apply production migrations.

## Handoff record template

Copy this template into the task/PR or a private task note. Keep it concise and never include credentials.

```text
Task:
Objective:
Non-goals / constraints:
Acceptance criteria:
Repository:
Feature branch:
Worktree identity (path or app-visible identifier):
Base commit SHA:
Current head SHA:
Worktree state (clean / staged / unstaged):
Relevant files and current diff summary:
Plan and implementation decisions:
Relevant conversation context (summary only; redact sensitive content):
Checks actually run and exact results:
Checks still required:
Known risks / unresolved questions:
Approval state and the exact plan/base/diff it covers:
Next action:
```

## Capability and failure rules

- **Supported:** a product flow that visibly opens the exact Copilot session/worktree in the other environment and preserves its context.
- **Fallback:** a manual, redacted handoff summary plus the same Git feature branch, where the destination product can access that branch.
- **Not supported / not proven:** automatic import of a VS Code Copilot chat into the Copilot App, automatic transfer of local uncommitted files, or guaranteed bidirectional session continuity.
- If the destination cannot access the same branch or the handoff context is incomplete, remain in VS Code. Do not claim the reverse transfer succeeded.
- This procedure does not implement a new Copilot API, install a Copilot extension, change subscription/billing, or create credentials. Revisit the automation only when GitHub documents and exposes a supported reverse-handoff interface.

## Acceptance checklist

- [ ] A feature branch and isolated worktree are identified.
- [ ] Base/head SHAs and worktree state are recorded.
- [ ] The handoff context is concise, redacted and reviewable.
- [ ] Any cross-app attachment/transfer is visibly confirmed; otherwise fallback is used.
- [ ] No parallel agent edits or lost changes remain.
- [ ] Local verification is recorded honestly.
- [ ] A reviewable PR is open against `main`.
- [ ] Exact-head CI/security checks complete.
- [ ] Human review is obtained before merge.
- [ ] No deployment, production migration, secret or paid-plan change occurred.
