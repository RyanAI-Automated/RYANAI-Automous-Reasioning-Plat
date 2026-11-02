---
name: code-review
description: Review a fixed diff independently against repository standards and the originating specification.
---

# Two-axis code review

Freeze the review base and head SHAs. Review the complete diff in two independent passes:

## Standards pass
- Correctness, security, privacy, least privilege and error handling.
- Repository conventions, types, module boundaries and maintainability.
- Concurrency, idempotency, timeouts, retries and resource cleanup.
- Tests that prove behavior rather than implementation details.

## Specification pass
- Every acceptance criterion is implemented and tested.
- No unrequested scope, hidden behavior or missing failure path.
- Migration, compatibility, observability and rollback match the agreed plan.
- UI controls and status claims are backed by real APIs/evidence.

Report findings by severity with exact file/line, impact, reproduction or reasoning, and a concrete fix. Distinguish blockers from suggestions. Re-run affected tests after fixes. A review is not approval to merge; branch protection and human review still govern.
