---
name: tdd
description: Implement behavior through a failing test, minimal fix, and refactor.
---

# Test-driven development

For each vertical slice:

1. Select one observable behavior from the agreed spec.
2. Add the smallest meaningful test at the right level (unit, integration or contract). Avoid testing implementation details.
3. Run only that test and capture the failure. Confirm it fails for the intended reason, not because setup is broken.
4. Implement the smallest change that makes it pass.
5. Run the focused test again, then relevant neighboring tests.
6. Refactor while keeping tests green.
7. Run typecheck, lint and the repository's required validation gates appropriate to the changed surface.

Tests must be deterministic, isolated, and clean up resources. Never use production credentials or data. Never replace real provider/DB integration evidence with mocks while claiming connectivity. Label mocked tests as mocked. If a test cannot be run, report why and leave it unverified.
