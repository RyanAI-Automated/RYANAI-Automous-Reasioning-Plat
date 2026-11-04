# RyanAI Patch Update Log

This file records pull requests only after GitHub confirms they are merged into `main`.
Entries are append-only and idempotent: the merge automation will not add the same PR number twice.

## PR #813 — fix: consolidate CI and security deployment blockers

- **Merged:** 2026-11-04 09:40:11 UTC
- **Merge commit:** `649a2f3dfbe489c22e2f49dfc6d23d326d8b1fdc`
- **Source branch:** `fix/unified-deployment-gates-20261104`
- **Changes:** corrected combined startup-outage assertion; installed Trivy from the official release with SHA-256 verification; split Codacy SARIF uploads into batches of at most 20 and enabled manual workflow dispatch.
- **Post-merge validation:** CI, Codacy and provider verification were still running or failing when this entry was prepared. See the merge commit's GitHub Actions runs; this entry records the merge, not a claim that all checks passed.
- **Deployment:** no hosting deployment was triggered by this log entry.

## PR #814 — ci: automatically update patch_update.md after every merged PR

- **Merged:** 2026-11-04T09:46:07Z
- **Merge commit:** `26a4a8c95daf93790d439b999654618509a6ab99`
- **Source branch:** `automation/patch-update-on-merged-pr`
- **Changes:**
- Add `patch_update.md` and record confirmed merge PR #813.
- Add an idempotent Node.js updater that records PR number, title, merge time, merge SHA, source branch and summary.
- Add a GitHub Actions workflow triggered only when a pull request closes with `merged == true`.
- Serialize updates and commit the log to `main`; duplicate PR events do not create duplicate entries.
- Does not merge PRs or deploy applications.
- Does not read or print secrets.
- Does not write a log entry for closed-but-unmerged PRs.
- Records merge confirmation separately from CI or deployment success.
- Branch is based on the confirmed PR #813 merge commit.
- Static review of workflow and updater is required before merge; no test pass is claimed.
- **Record type:** confirmed merge; this entry does not imply deployment or passing post-merge checks.
