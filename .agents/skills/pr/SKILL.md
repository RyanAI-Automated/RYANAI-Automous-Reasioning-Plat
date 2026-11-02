---
name: pr
description: Prepare reviewable pull requests with scope, evidence and merge-risk clarity.
---

# Pull request discipline

Every PR must include:
- A concise summary and explicit scope/non-goals.
- Why the change is needed and links to its spec/issues.
- Files/components changed and relevant architecture boundaries.
- Tests actually run, with outcomes; identify skipped/unavailable checks.
- Runtime evidence where applicable, tied to commit SHA and environment.
- Database migration, data handling, secret, permission and rollback impacts.
- A merge-risk assessment: reversible or one-way door, blast radius, mitigations.
- Explicit statement that the PR is not merged/deployed unless verified.

Do not label a PR production-ready based on code presence or a mergeable flag. Required CI/security checks and human approval remain authoritative.
