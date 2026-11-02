# Agent evaluation and incremental migration methodology

## Research inputs

- [Microsoft: Cheap code, precious trust — Code modernization at scale](https://commandline.microsoft.com/agentic-software-engineering-large-scale-code-migration-language-modernization-spec-driven-development/)
- [GitHub: Migrating the GitHub Copilot runtime to Rust, using Copilot](https://github.blog/ai-and-ml/generative-ai/migrating-the-github-copilot-runtime-to-rust-using-copilot/)
- [Adelie](https://github.com/lmliheng/Adelie), a local-first multi-agent app development platform built as an Apache-2.0 fork of PenguinHarness.

## What RyanAI should learn from Adelie

Adelie combines app scaffolding, benchmark/evaluation loops, pre-optimisation snapshots, request traces, skills/plugins and configurable model connections. These are useful product patterns to evaluate, not a reason to replace RyanAI's existing control plane or install a second agent platform into production.

Recommended RyanAI capabilities:

1. **Task-to-app scaffolding:** turn an approved specification into a bounded branch/worktree, code changes and run instructions.
2. **Repeatable evaluation:** run a fixed visible development set after each change, with baseline comparisons and a saved snapshot before each optimisation round.
3. **Independent holdout set:** keep a second set of evaluation tasks inaccessible to the coding agent and optimiser. Reveal only aggregate scores and failure categories, never the exact hidden prompts, expected outputs or hidden tests. Rotate or refresh holdouts to reduce benchmark overfitting.
4. **Trace replay:** retain redacted inputs, model/provider/version, tool invocations, tool results, resource usage, policy decisions, timings, outputs and commit/environment identifiers. Replays must not reissue external side effects.
5. **Model adapters:** evaluate NVIDIA, Qwen and Logic independently through the existing provider abstraction and only use configured, authenticated providers.
6. **Skill provenance:** pin plugin/skill source, version, license and permissions; review before installation and isolate execution.

Do not install Adelie as a dependency or grant it RyanAI credentials. Its README identifies it as a separate productised fork of PenguinHarness, requires Node 24 for source/npm use, and describes its own CLI/server/data-root and release pipeline. A disposable local evaluation is the appropriate first step if later approved.

## Hidden holdout evaluation contract

A meaningful optimiser must not see the cases used to decide whether it improved:

- **Development set:** visible to the implementation agent; used for rapid local feedback.
- **Holdout set:** stored and executed by a separate evaluator identity/workflow; not mounted in the agent workspace and not returned in full to the agent.
- **Baseline snapshot:** immutable source commit, dependency lock, prompt/skill versions, model configuration identifier, benchmark version, environment and initial scores.
- **Optimisation snapshot:** capture the same fields before each optimisation round so regressions can be attributed and reverted.
- **Scoring:** use deterministic assertions where possible; human-reviewed rubrics for subjective outputs. Include task success, regression rate, policy compliance, tool correctness, latency and cost.
- **Feedback boundary:** give the optimiser aggregate scores and sanitized failure categories. Keep test case content, expected outputs and private oracle details separate.
- **Anti-leakage:** audit access logs, prohibit agent edits to the evaluator/oracle, and require human approval to change hidden cases or scoring criteria.
- **Fresh generalisation:** periodically add unseen tasks from newly authored scenarios and rotate a portion of the holdout. A score on repeated known tasks is not evidence of generalisation.
- **Acceptance:** improvements must persist on holdout tasks and must not regress existing end-to-end contracts or security policies.

The holdout set must be protected from both the agent and the code author where practical. The agent being evaluated must not be able to weaken tests, update snapshots, alter thresholds, skip failing cases or change the evaluator workflow.

## Incremental migration playbook

Microsoft's guidance and GitHub's Copilot runtime migration converge on an incremental, behavior-preserving approach:

1. State the exact end state, scope and non-goals before delegating.
2. Map module boundaries and dependencies; prioritize isolated, high-value slices.
3. Build/strengthen independent end-to-end tests before changing implementation.
4. Capture the current implementation as the behavioral oracle. Keep the test oracle outside the migrating agent's write permissions.
5. Translate one user-visible feature or component at a time. Preserve behavior and algorithms; do not combine a language rewrite with opportunistic redesign.
6. Use differential tests to run old and new implementations on the same fixtures and compare outputs, side effects and error behavior.
7. Keep every PR small, reviewable and independently revertible. Main remains shippable; do not run a big-bang rewrite.
8. Run the complete existing end-to-end suite against the new implementation at every step.
9. Roll out behind a disabled-by-default selector or narrow cohort only after CI and shadow comparisons; monitor and roll back on regressions.
10. Optimize algorithms and redesign around the new language/runtime only after behavior preservation is established.

## RyanAI application

- Apply the method first to the durable agent queue and sandbox boundaries, where reliability and process isolation matter.
- Do not start a whole-platform TypeScript-to-Rust migration. RyanAI currently has a mixed stack; choose Rust only for a measured subsystem requirement such as CPU-bound work, native embedding, memory bounds or process isolation.
- If a future Rust component is justified, define a narrow stable API and retain TypeScript callers through a versioned boundary. Do not duplicate the full runtime or create a permanent dual implementation without an explicit migration plan.
- Run the new component against the old implementation in CI or a shadow environment. Preserve the original end-to-end tests as the independent oracle.
- Every migration PR includes the source/target contract, differential tests, performance/resource benchmark, rollback instructions and exact evidence.
- Keep production credentials, production data and deployment permissions out of agent workspaces.

## Decision

Adopt the methodology, not the products wholesale. RyanAI's existing PostgreSQL queue, skills, provider adapters, GitHub CI and sandbox work remain the foundation. Evaluate Adelie separately in a disposable local environment only if it demonstrates a concrete gap that RyanAI cannot meet safely.
