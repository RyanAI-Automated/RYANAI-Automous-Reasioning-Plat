# RyanAI Intelligence Improvement Protocol (RIIP)

**Status:** Versioned governance baseline. The policy file is authoritative for machine-checkable invariants; this document explains its operation. It does not claim that every registered provider or specialist is running or production-verified.

## Governing doctrine

> RyanAI owns its intelligence. Models serve it. Gen-X protects it. Human authority governs it.

Every proposed change must demonstrate measurable benefit, security compliance, operational reversibility, and economic justification. The cost denominator is an accepted successful task, and costs are reported in ZAR.

## One policy, many model implementations

`governance/model-governance.yaml` is the single machine-readable RIIP baseline for reasoning providers, local inference, and specialist models. Provider-specific prompts may adapt the wording and format for each model, but may not weaken the shared authority, security, privacy, or approval rules.

The registry distinguishes configuration from verification:

- `configured_unverified`: a provider slot is configured in source; credentials and live inference have not thereby been proven.
- `adapter_merged_runtime_unverified`: adapter code is merged; daemon, installed weights, and successful runtime inference remain unverified.
- `evaluation_only`: offline/isolated evaluation only; not production activation.
- `deferred_legal_review`: disabled pending licence and baseline review.
- `verified`: reserved for a revision with reproducible evidence for the required workload and environment.
- `disabled`: intentionally unavailable.

A model name, environment variable, health route, or successful configuration parse is never sufficient evidence of model health.

## Authority and execution

1. Authenticate the requesting principal and establish tenant/resource scope.
2. Resolve a registered model and its permitted task family.
3. Apply deterministic Gen-X authorization before any protected operation.
4. Invoke the model with minimum necessary, provenance-labelled context.
5. Treat model output, tool proposals, retrieved text, and extracted content as untrusted data.
6. Validate output schemas, size limits, source provenance, and task-specific quality.
7. Re-check every proposed action through Gen-X at the execution boundary.
8. Require explicit, scoped human approval for consequential actions.
9. Record policy version, model/checkpoint revision, correlation ID, decision, result, and outcome without logging secrets or unnecessary private content.

Models may not authorize actions, modify their own permissions, approve their own changes, promote themselves, merge code, or deploy. Gen-X's authorization decision is independent of model reasoning. Policy, identity, or approval failure must fail closed.

## Engineering acceptance contract

A candidate change must include:

- **Measurable benefit:** baseline and candidate evaluated on the same held-out, representative workload; report quality by critical slice, not only an aggregate.
- **Security compliance:** exact checkpoint licence, data handling, least privilege, isolation, bounded resources, provenance, and authorization tests.
- **Operational reversibility:** pinned known-good revision, explicit fallback, tested rollback, and (for embeddings) separate versioned indexes with no mixed vector spaces.
- **Economic justification:** total attributable inference, compute, power, storage, network, maintenance, and human-correction cost divided by accepted successful tasks, reported in ZAR.

Hard failures in security, privacy, licence, authorization, or data ownership cannot be offset by a high weighted score.

## Evaluation and promotion lifecycle

| Stage | Permitted work | Exit evidence |
| --- | --- | --- |
| 0. Register | Record owner, role, provider, revision, licence, task scope and status | Registry validation |
| 1. Offline benchmark | Use isolated, access-controlled, synthetic or redacted held-out data | Reproducible baseline/candidate report |
| 2. Security review | Test data boundaries, injection resistance, isolation, output validation and authorization | No critical finding; Gen-X boundary proven |
| 3. Controlled pilot | Explicit opt-in/feature flag, limited scope and monitored fallback | Quality, latency, failure, resource and cost evidence |
| 4. Promotion proposal | Prepare a revisioned change and rollback plan | Human approval and required CI/security checks |
| 5. Operate | Monitor drift, errors, cost, fallback, language slices and provenance | Periodic re-evaluation and rollback readiness |

No automatic model download at API startup, automatic production activation, automatic embedding-index replacement, or model-selected self-promotion is permitted.

## Metrics

Report at minimum:

- Task quality: task success, precision/recall/F1, WER/CER, retrieval Recall@k/nDCG@k/MRR as applicable.
- Reliability: success/failure/abstention rates, provider availability, timeout rate, recovery and fallback frequency.
- Performance: cold/warm latency p50/p95, throughput, peak RAM/VRAM and queue delay.
- Economics: cost per accepted successful task in ZAR, including attributable human correction and operations.
- Security: policy violations, cross-tenant access attempts, unsafe tool proposals, provenance gaps and audit completeness.

South African English (`en-ZA`) and Tshivenda (`ve-ZA`) must be evaluated separately for language-dependent speech workloads. Do not infer language support from a model card or UI locale.

## How to validate

Run:

```bash
node scripts/validate-model-governance.mjs
node --test scripts/validate-model-governance.node-test.mjs
```

The validator checks machine-readable invariants. It does not test provider connectivity, model quality, licence interpretation, production security, or live rollback. Those require separate evidence and must not be inferred from a passing policy test.

## Change control

Changes to the RIIP policy require a focused pull request, threat analysis, tests, authorized human review, and protected-branch checks. Model-generated proposals cannot weaken the policy or approve themselves. No deployment, credential, production data, database migration, or paid infrastructure change is authorized by this standard.
