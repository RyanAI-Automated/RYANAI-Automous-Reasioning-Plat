# RyanAI architecture and governance reference

**Status:** Architecture and acceptance standard, updated 4 November 2026. This document distinguishes merged code foundations from target requirements and outstanding verification. It is not a production-readiness certificate.

## 1. Governing principle

> **RyanAI owns its intelligence. Models serve it. Gen-X protects it. Human authority governs it.**

RyanAI must select, measure, replace, and improve specialist models independently. It must not become dependent on additional models merely because they are available or publish strong external benchmark scores.

The success measure is useful, verified intelligence per rand spent, without sacrificing accuracy, privacy, security, reliability, or user control.

Every proposed change must demonstrate all four acceptance dimensions:

1. **Measurable benefit:** a reproducible improvement against a representative baseline.
2. **Security compliance:** independently verified identity, authorization, isolation, privacy, and audit controls.
3. **Operational reversibility:** a tested fallback, rollback, and recovery procedure.
4. **Economic justification:** total cost and value measured in ZAR, not parameter count or headline speed alone.

A change that fails a mandatory security, authorization, licence, or privacy gate must not be promoted regardless of its aggregate score.

## 2. System context and responsibility boundaries

| Domain | Responsibility | Trust boundary |
| --- | --- | --- |
| RyanAI application/API | Authenticated ingress, request validation, orchestration, persistence, user-facing results | The trusted application enforces identity and authorization; model output is untrusted |
| RyanAI Comms | Transcription, extraction, speech, and controlled communications workflows | Drafting/analysis is separate from sending, calling, and provider dispatch |
| Private RAG | Private document ingestion, OCR/parsing, embeddings, retrieval, and grounded responses | Owner-scoped access, provenance, retention, and deletion controls apply throughout |
| Gen-X Security | Independent authorization, policy enforcement, and security checks | Policy decisions are deterministic and independent of model decisions |
| Jarvis | Restricted engineering analysis, testing, and proposed code changes | No self-granted permissions, secret access, self-approval, direct merge, or deployment |
| Human operator | Approval of consequential and irreversible actions | Explicit authorization remains outside model control |

Specialist models may return suggestions or derived data. They do not become trusted principals and must not be given unrestricted MCP, shell, filesystem, network, credential, repository-write, or deployment access.

## 3. Persistence, memory, and private data

PostgreSQL is the authoritative durable application and memory store; pgvector is the vector-search foundation for semantic retrieval. Prisma schema and migrations define the relational data contract. Redis may support runtime coordination and caching, but it is not the authoritative long-term memory store.

Required data controls:

- Scope conversations, documents, tasks, embeddings, and derived results to the authenticated owner or explicitly authorised tenant.
- Preserve source references, timestamps, model/checkpoint versions, and transformation provenance for derived facts and extracted fields.
- Treat uploaded documents, audio, retrieved passages, prompts, and model outputs as untrusted data, never as instructions that can override policy.
- Apply content-type and size limits, malware scanning/quarantine, secure object access, retention, and deletion propagation before adding new media-processing paths.
- Do not expose private source content, signed URLs, credentials, or raw media in ordinary logs.
- Keep embedding model versions and vector indexes separate. Never compare or mix vectors from incompatible embedding spaces.
- Preserve the previous index and a tested rollback path before changing the active embedding model.

A configured database, vector extension, or storage bucket is not proof that migrations, access policies, backups, or restore procedures have been validated. Verify these against a disposable/staging environment before production changes.

## 4. Inference and replaceable specialist layer

### 4.1 Reasoning foundation

The existing NVIDIA, Qwen, and Logic reasoning roles remain distinct configured capabilities. The explicit local Ollama adapter added in PR #864 provides a local inference mode through the shared model factory.

Local mode requires:

```dotenv
RYANAI_INFERENCE_MODE=local
OLLAMA_URL=http://ollama:11434/v1
OLLAMA_MODEL=qwen2.5:7b
```

The actual model must already be installed in the trusted local Ollama runtime. The adapter is designed to validate local endpoint configuration and fail closed rather than silently fall back to a cloud provider. These environment settings do not prove that the daemon is running, the model is present, or inference works.

### 4.2 Specialist Intelligence Layer

Specialists should sit behind stable, typed, versioned interfaces. Each adapter should declare:

- Task type and input/output schema.
- Exact model and checkpoint revision, licence, and provenance.
- Runtime and dependency versions.
- Resource, input-size, timeout, and concurrency limits.
- Health and readiness semantics based on real inference probes.
- Failure, abstention, timeout, and fallback behaviour.
- Metrics, audit metadata, and safe data-retention behaviour.

Models should be independently replaceable without rewriting the orchestrator or changing the authoritative persistence layer. Do not download model weights during API startup. Provision pinned artifacts through an explicit, reviewed process and verify hashes where available. Isolate heavyweight runtimes to avoid dependency conflicts.

### 4.3 Candidate policy

The merged PR #866 establishes the evaluation rubric and adoption gates. Its fit scores are preliminary architecture-fit estimates, not RyanAI benchmark results or production approvals.

- **GLiNER:** offline entity-extraction evaluation; verify exact checkpoint licence and source-span provenance.
- **EmbeddingGemma 300M:** parallel retrieval evaluation only; verify gated terms and keep its vector index separate.
- **PaddleOCR-VL 1.6:** document parsing evaluation after the secure attachment pipeline is verified; confirm exact checkpoint licence.
- **Parakeet TDT 0.6B v3:** conditional ASR evaluation; European-language coverage does not establish Tshivenda support.
- **Kokoro-82M:** conditional TTS evaluation; test South African English and Tshivenda pronunciation and intelligibility.
- **Arch-Router 1.5B:** defer pending legal review and comparison with deterministic routing.
- **Nemotron-Orchestrator-8B:** do not use in production under the research-only licence terms described in the source proposal unless suitable production rights are independently obtained.

No candidate becomes a runtime dependency simply by appearing in this list.

## 5. RyanAI Comms: transcription, extraction, and speech

PR #864 merged the fail-closed local inference adapter. PR #865 merged Python orchestration interfaces and authenticated communications MCP contracts for reading channel policy and preparing drafts. These interfaces are deliberately narrower than provider dispatch: they do not grant permission to send messages, place calls, or initiate external communications.

The Comms roadmap is to evaluate each task independently:

### Transcription (ASR)

- Build separate held-out evaluation slices for South African English (`en-ZA`) and Tshivenda (`ve-ZA`).
- Measure word error rate (WER), character error rate (CER), named-term accuracy, speaker/noise robustness where relevant, real-time factor, p50/p95 latency, and abstention/failure rate.
- Record language-specific results; do not average away poor performance on one language.
- Retain an approved fallback when the selected model does not support the language or confidence is insufficient.

### Information extraction

- Measure exact-span precision, recall, and F1 by entity/field type.
- Track calibration, false-positive rate, schema validity, source-span/provenance completeness, and human correction rate.
- Treat extracted values as untrusted until validated against schemas and policy.

### Speech generation (TTS)

- Evaluate `en-ZA` and `ve-ZA` separately with consented, representative text.
- Use blinded human assessments for intelligibility, pronunciation, naturalness, and accessibility.
- Measure startup delay, real-time factor, p50/p95 latency, resource use, and fallback rate.
- Do not infer language/voice support from a locale selector or a model's general multilingual claim.

The existence of orchestration contracts does not establish that a local model is installed, a provider is connected, or an end-to-end channel test has passed.

## 6. Private RAG: document understanding and retrieval

Document ingestion must follow a controlled pipeline:

1. Authenticate the user and establish document ownership.
2. Validate file type, size, page count, and structure; quarantine and scan before processing.
3. Process a bounded, isolated copy with no secret or unrestricted network access.
4. Parse text, tables, layout, and fields; validate output against explicit schemas.
5. Store only necessary extracted content with source references, owner scope, and provenance.
6. Embed using a pinned model version and a separate versioned index.
7. Retrieve only records the requesting identity is authorised to access.
8. Ground responses in retrieved sources and preserve citations/traceability.
9. Apply retention and deletion requests to source files, extracted records, and derived vectors.

Benchmark OCR/document understanding, extraction, and embeddings as separate workloads. A document parser's benchmark score does not establish retrieval quality; an embedding score does not establish source-grounded answer quality.

PaddleOCR-VL and GLiNER are candidates for controlled offline evaluation. EmbeddingGemma may be tested in a separate versioned index. Do not alter live memory writes or replace the active vector index until retrieval quality, licence, privacy, migration cost, and rollback are verified.

## 7. Gen-X: independent authorization authority

Gen-X is a security and policy enforcement boundary, not another model that can be persuaded to approve an action.

Required design properties:

- Authorization is deterministic, deny-by-default, and evaluated outside model-generated reasoning.
- Identity comes from a verified authenticated principal, not a model-supplied user ID, role, or claim.
- Every tool/action is checked against an explicit capability allowlist, resource scope, and current policy at the execution boundary.
- Permission grants are issued only by trusted application/operator controls; no model, agent, or orchestrator can create or expand its own grants.
- Secret access is restricted to the smallest trusted service that needs a credential. Secrets are never placed in prompts or model-visible tool results.
- Model output, retrieved content, tool arguments, and task payloads are untrusted and schema-validated.
- Consequential actions require an explicit human approval bound to the exact action payload and relevant version/digest; any material change invalidates that approval.
- Audit records identify the authenticated actor, requested action, policy decision, approval, execution outcome, and relevant version/digest without recording secret values.
- Security controls fail closed when identity, policy, audit persistence, or approval verification is unavailable.

No specialist model, Jarvis, or orchestration component may grant itself access, access secrets outside its explicit scope, approve consequential actions, bypass Gen-X, or override human approval.

This section defines the required authority model. It is not a claim that every control has already been implemented or independently verified.

## 8. Jarvis: controlled engineering assistance

Jarvis remains restricted until its identity, permissions, execution environment, and evidence trail are independently verified.

Permitted capability should progress in stages:

1. Read-only inspection of explicitly authorised repository material.
2. Analysis and test planning with no write capability.
3. Isolated, resource-bounded test execution using non-production data and credentials.
4. Patch preparation on a dedicated branch with path and content controls.
5. Pull-request creation after explicit approval, with exact commit and diff recorded.
6. Further capabilities only after independent review of the preceding stage.

Jarvis must not inherit production secrets, developer home directories, unrestricted network access, or production database access. It must not self-approve, merge, deploy, change secret settings, or expand its own permissions. Keep patch preparation separate from merge and deployment permissions. Preserve human review, required CI/security checks, and branch protection.

A successful command, generated patch, or model assertion is not proof of correctness. Record actual exit codes, test output, commit SHA, diff digest, actor identity, and review/approval evidence. Hash chains support tamper evidence but are not a substitute for authenticated provenance or digital signatures.

## 9. Fallback, replacement, and rollback

Every specialist must be removable without taking down unrelated RyanAI capabilities.

- Pin the current and candidate revisions.
- Keep a known-good baseline and explicit fallback route.
- Define timeout, cancellation, retry, circuit-breaker, and safe-abstention behaviour.
- Test model unavailable, malformed output, unsupported language, low confidence, rate limit, and resource exhaustion.
- Use feature flags or explicit routing configuration for controlled promotion.
- For embeddings, maintain separate versioned indexes and preserve the old index until rollback is tested.
- For document and media pipelines, retain the original private artifact and provenance so derived data can be regenerated or deleted.
- Record the model used for each derived result so replacement does not erase lineage.
- Roll back automatically only to a previously approved version; do not let a model choose or install its own replacement.

A fallback is accepted only after a test demonstrates that it works and preserves authorization, data isolation, and output provenance.

## 10. Benchmarking and intelligence-per-rand accounting

Use a held-out, representative, access-controlled evaluation corpus. Include a simple deterministic baseline and the current production candidate. Do not use the candidate's own training/evaluation benchmark as the only evidence for adoption.

| Workload | Quality measures | Operational measures |
| --- | --- | --- |
| OCR/document parsing | CER; field precision/recall/F1; table/layout accuracy | Pages/minute; p50/p95; peak RAM/VRAM; malformed-file and timeout rate |
| Extraction | Exact-span precision/recall/F1; calibration; schema validity | False-positive rate; provenance completeness; human correction rate |
| Embeddings/retrieval | Recall@k; nDCG@k; MRR; grounded answer relevance | Index size; embedding/query latency; rebuild and rollback cost |
| ASR | WER/CER and named-term accuracy by `en-ZA` and `ve-ZA` | Real-time factor; p50/p95; peak memory; unsupported-language/fallback rate |
| TTS | Blinded intelligibility, pronunciation, naturalness, and accessibility | Startup delay; real-time factor; p50/p95; peak memory |
| Routing/decision support | Task success; safe abstention; policy violation rate | Invalid route rate; unnecessary calls; latency and escalation rate |

For every run, record dataset version, exact model/checkpoint hash, licence, runtime/library versions, hardware, quantization, prompt/configuration, cold and warm latency, throughput, peak RAM/VRAM, failures, and fallback frequency.

Define:

`cost_per_successful_task_ZAR = total_attributable_cost_ZAR / accepted_successful_tasks`

Total attributable cost should include inference/provider charges, compute, electricity, storage, network where material, amortized hardware, and maintenance/operations. Define a successful task before the benchmark: it must meet the quality threshold, pass schema and policy validation, and not require an uncounted human correction. Report cost alongside quality, reliability, and security; never optimize cost by accepting unsafe or incorrect output.

Promote a candidate only if it clears legal, privacy, security, language, and authorization gates; is non-inferior on critical workload slices; demonstrates a meaningful measured benefit; and has a tested fallback and rollback.

## 11. Engineering and release gates

The engineering sequence is:

1. Complete the outstanding disposable PostgreSQL/pgvector and migration checks.
2. Obtain completed CI, test, and security results for the exact current commit; queued, skipped, cancelled, or stale checks are not passes.
3. Independently verify that the `main` branch ruleset enforces pull requests and the required status checks, blocks force pushes, and restricts bypass.
4. Verify the local Ollama runtime and the Comms orchestration contracts with real, controlled tests.
5. Verify the secure attachment/ingestion path before document and media pilots.
6. Run offline specialist benchmarks and publish reproducible results.
7. Pilot one specialist at a time behind explicit configuration/feature gates.
8. Review security, operational reversibility, and ZAR economics before promotion.

PR #863 records a point-in-time review of the database, CI/security, and branch-protection gates. PRs #864 and #865 add local inference and communications contracts; PR #866 adds specialist-model fit and adoption policy. Their merged status must not be treated as proof of live runtime health or successful current-head checks. Re-read current GitHub evidence before declaring a gate complete.

No production activation, deployment, paid infrastructure upgrade, secret change, or database migration is authorised by this architecture document.

## 12. Non-negotiable engineering doctrine

- No unnecessary model dependencies.
- No unverified capability claims.
- No unrestricted autonomous permissions.
- No irreversible changes without explicit authorization.
- No production activation without reproducible evidence.
- No model-generated authorization.
- No silent cloud fallback from a local-only inference mode.
- No mixing of incompatible embedding spaces.
- No benchmark score without workload, hardware, revision, and dataset provenance.

**RyanAI owns its intelligence. Models serve it. Gen-X protects it. Human authority governs it.**


## 13. Universal model governance contract (RIIP)

The machine-readable source of truth for model onboarding and engineering acceptance is `governance/model-governance.yaml`. The full operational lifecycle is documented in [RIIP Universal Model Governance](architecture/RIIP-UNIVERSAL-MODEL-GOVERNANCE.md), with registry semantics in [RIIP Model Registry](architecture/RIIP-MODEL-REGISTRY.md).

Every reasoning provider, local inference adapter, and specialist must be registered with an explicit task-family allowlist, truthful verification status, and evaluation requirement. Provider configuration and merged adapter code are not runtime health evidence. Candidate specialists remain offline/evaluation-only until their exact revision, licence, representative workload, security, language, ZAR economics, fallback, and rollback are independently evidenced.

RIIP makes the governing boundary machine-checkable: model outputs are untrusted; models cannot authorize actions, alter their own permissions, approve their own changes, merge, deploy, or promote themselves. Gen-X remains the independent authorization enforcement point, and consequential actions remain subject to human approval. The policy validator and regression tests are included in the repository validation pipeline.

This policy baseline does not itself implement runtime routing, enable specialist models, download weights, alter production configuration, or certify live provider health.
