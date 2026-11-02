---
name: diagnosing-bugs
description: Reproduce and minimise bugs before forming a testable hypothesis and fixing them.
---

# Diagnosing bugs

1. Capture exact error, environment, commit, command, timestamp and expected/actual behavior.
2. Reproduce on a safe local or disposable environment. Never reproduce destructive failures against production.
3. Minimise the reproduction until one cause or boundary is implicated.
4. State a falsifiable hypothesis and what evidence would disprove it.
5. Add temporary, sanitized instrumentation at the boundary; never log secrets, tokens, personal data or full connection strings.
6. Test the hypothesis. Change one causal factor at a time.
7. Fix the cause, add a regression test, and run adjacent regression checks.
8. Remove temporary instrumentation and report remaining uncertainty.

Do not guess from symptoms, perform speculative multi-file edits, suppress errors to make health checks green, or claim a fix without reproducing the original failure and observing the regression test.
