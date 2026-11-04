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

