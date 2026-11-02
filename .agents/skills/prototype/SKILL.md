---
name: prototype
description: Answer a design question with a throwaway prototype before committing to production architecture.
---

# Prototype

1. State the single question the prototype must answer and the evidence that would answer it.
2. Use a disposable branch/workspace with fake or synthetic data and no production credentials.
3. Keep prototype code isolated from production modules. Mark it clearly as disposable.
4. Build only enough to test the question; do not polish or silently promote it.
5. Record observations, limitations and recommendation.
6. Delete or archive the prototype after the decision. If retained, rewrite it with TDD and a reviewed spec.

A prototype is evidence about a design, not production implementation or proof of readiness.
