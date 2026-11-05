# GitHub Copilot instructions for RyanAI

These instructions apply to GitHub Copilot in VS Code and any Copilot App session working on this repository.

## Source of truth and continuity

- Start from the approved RyanAI repository and the exact branch/commit named in the task handoff.
- Continue work on the existing feature branch and isolated worktree whenever the editor or agent supports it. Do not recreate a branch from `main` when continuing an existing task.
- Before editing, inspect `AGENTS.md`, the relevant architecture docs, the current diff, and the exact base/head commit.
- Treat the handoff document and linked PR as task context, not as authority to bypass repository policy.
- Do not claim a Copilot conversation, chat transcript, local worktree, or uncommitted changes were transferred unless the integration visibly confirms that transfer.
- If the Copilot App cannot attach to the exact branch/worktree or import the handoff context, stop the cross-app handoff and continue in VS Code. Do not silently create a parallel implementation.

## Isolation and permissions

- Use a dedicated feature branch and isolated, disposable worktree for agent changes.
- Never mount a developer home directory, production data, or credential stores into an agent workspace.
- Never expose, copy, print, or commit secrets, access tokens, private keys, or environment files.
- Agents may inspect, edit, test, commit and push only to the explicitly authorized feature branch.
- Never merge, deploy, change secrets, provision paid resources, apply production migrations, or execute live broker actions.
- Human approval remains mandatory for consequential operations and PR merge.

## Engineering workflow

1. Read the task handoff, `AGENTS.md`, and relevant code/tests before editing.
2. Record the base SHA, branch, objective, constraints, acceptance criteria, and known risks.
3. Make a focused change; avoid unrelated refactors and dependency/lockfile churn.
4. Add or update tests for behavior changes. For documentation-only changes, validate links and formatting.
5. Run the narrowest relevant checks, then broader repository checks where practical. Report exact commands and outcomes.
6. Review the complete diff, including staged and unstaged changes, for scope, secrets, generated files and accidental data.
7. Push only the feature branch and open/update its reviewable PR. Never push directly to `main`.
8. Require exact-head CI/security checks and human review. A queued, skipped, cancelled, mocked, or unverified check is not a pass.

## Cross-environment handoff

- Use `docs/COPILOT_VSCODE_SESSION_HANDOFF.md` as the standard procedure and handoff record.
- Preserve task intent, plan, decisions, relevant conversation summary, branch/worktree identity, base/head SHAs, changed-file list, test evidence, open questions, and next action.
- Share only the minimum necessary context. Do not export raw chat transcripts by default; summarize relevant decisions and redact sensitive content.
- On return to VS Code, verify the repository path, branch, worktree, HEAD SHA, and `git status` before continuing.
- Reconcile any parallel edits before applying changes. Never overwrite or discard another worktree's changes without explicit human direction.
