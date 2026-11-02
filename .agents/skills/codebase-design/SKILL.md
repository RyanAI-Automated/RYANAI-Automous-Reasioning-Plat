---
name: codebase-design
description: Improve module boundaries by placing substantial behavior behind small, testable interfaces.
---

# Codebase design

- Identify the change's stable responsibility and the callers that need it.
- Prefer a deep module: small public interface, cohesive implementation, explicit invariants.
- Place I/O at boundaries; keep domain decisions deterministic and testable.
- Avoid pass-through wrappers, duplicate abstractions, global mutable state and premature generalization.
- Preserve existing contracts unless the spec authorizes a breaking change.
- Document important domain terms and architectural decisions.
- Validate through public interfaces and behavior tests, not private implementation details.
