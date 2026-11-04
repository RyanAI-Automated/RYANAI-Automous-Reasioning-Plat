# RyanAI Patch Update Log

This file records **only pull requests that GitHub confirms as merged into `main`**. Entries are newest first. Closed-unmerged, draft, and merely passing PRs are excluded.

## 2026-11-04 — PR #813: fix: consolidate CI and security deployment blockers

- **Status:** Merged
- **Merged at:** 2026-11-04 09:40:11 UTC
- **Merge commit:** `649a2f3dfbe489c22e2f49dfc6d23d326d8b1fdc`
- **Pull request:** https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/813

### Changes delivered

- `.github/workflows/codacy.yml`: reduced SARIF upload batches to GitHub's 20-run limit and added manual workflow dispatch.
- `.github/workflows/security.yml`: downloads Trivy directly from its official GitHub release and verifies the published SHA-256 checksum before installing and scanning.
- `scripts/test-startup-resilience.mjs`: corrected the combined PostgreSQL/Redis outage assertion to expect the aggregate fail-closed diagnostic, including the dependent agent checkpointer.

### Validation evidence recorded in the merged PR

- Startup-resilience candidate run **41788577598** passed full CI, including integration and E2E.
- Trivy security run **41791842960** passed the filesystem scan and dependency audit.
- Codacy SARIF batching run **41790117276** passed all three SARIF upload steps.
- These are independently validated source-fix runs described in the PR; the merged PR's own checks remain the authoritative merge-time evidence.

### Follow-up

- Verify the merged workflows execute successfully on `main`.
- Continue deployment diagnosis across Vercel, Render, and Railway without weakening verification gates or changing secrets or plans.
