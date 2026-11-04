# RyanAI Specialist Model Fit and Adoption Standard

**Status:** Evaluation policy and staged adoption proposal; no specialist model is enabled by this document.
**Date:** 2026-11-04
**Scope:** Local-first specialist models for transcription, document parsing, entity extraction, retrieval, routing, decisions, and speech generation.

## Executive decision

RyanAI should add a model-independent Specialist Intelligence Layer (SIL) behind its existing orchestrator. Specialist models are task workers, not authorities. They may classify, extract, transcribe, embed, parse, or propose routes; they cannot grant permissions, authorize tool calls, approve patches, access secrets, or promote deployments.

Keep PostgreSQL/pgvector as the authoritative persistent memory foundation, Ollama as the local inference foundation, and the existing NVIDIA/Qwen/Logic reasoning roles as configured and independently verified. Do not replace existing components until a representative benchmark demonstrates a measurable improvement.

The current local-inference foundation is being handled separately in PR #864. Its checks were queued when this proposal was prepared. A configured endpoint or model name is not evidence that Ollama is running or that inference succeeds.

## Weighted fit rubric

Each candidate is scored from 0 to 100 using the following weighted dimensions:

| Dimension | Weight | Evaluation question |
| --- | ---: | --- |
| Functional value | 25 | Does it solve a real RyanAI workload with measurable benefit? |
| Architecture compatibility | 20 | Can it run behind existing interfaces without replacing core persistence or orchestration? |
| Security and operations | 20 | Can it run with least privilege, bounded inputs, observable failures, and safe isolation? |
| Language and regional suitability | 15 | Does it support the required South African English and Tshivenda use cases where relevant? |
| Cost and hardware efficiency | 10 | Does it fit available CPU/GPU/RAM and reduce total cost per successful task? |
| Licence and distribution | 10 | Are weights, code, and commercial/production use terms verified for the exact checkpoint? |

**Score bands:** 85-100 strong pilot candidate; 70-84 controlled pilot; 55-69 research only; below 55 defer/reject for production. A score never overrides a legal, privacy, security, or language hard gate.

## Preliminary fit scores

These are architecture-fit estimates based on the supplied article and RyanAI's known requirements. They are not RyanAI benchmark results, licence opinions, or production approvals.

| Candidate | Fit / 100 | Disposition | Main reason / condition |
| --- | ---: | --- | --- |
| GLiNER (exact checkpoint to be verified) | 94 | Pilot candidate | Useful for structured extraction from issues, PRs, tasks, communications, and documents; verify the checkpoint licence and extraction quality on RyanAI data. |
| EmbeddingGemma 300M | 92 | Pilot candidate | Relevant to semantic retrieval over PostgreSQL/pgvector; gated Gemma terms and index migration/re-embedding make it an opt-in parallel benchmark, not a silent replacement. |
| PaddleOCR-VL 1.6 | 91 | Pilot candidate | Strong document parsing use case; validate exact Apache-2.0 model-card terms, runtime isolation, CPU/GPU footprint, and secure attachment flow. |
| Parakeet TDT 0.6B v3 | 78 | Conditional pilot | Useful English ASR candidate; its stated 25-language coverage does not establish Tshivenda support. Keep multilingual fallback. |
| Kokoro-82M | 76 | Conditional pilot | Lightweight TTS candidate; test South African English pronunciation, Tshivenda coverage, voice quality, and accessibility before adoption. |
| Arch-Router 1.5B | 67 | Defer | Potential routing value, but custom research licence needs legal review; benchmark against deterministic policy-controlled routing first. |
| Nemotron-Orchestrator-8B | 48 | Reject for production | Article reports research-and-development-only licensing. Do not use in production unless a suitable production licence is independently obtained. |

The article's published comparisons are useful hypotheses, not transferable guarantees. Some comparisons use older baselines or different task datasets. Reproduce them on RyanAI's own workloads.

## Target architecture

1. **Ingress and validation:** authenticate the user, validate content type/size, scan files, establish ownership, and apply data minimisation before model processing.
2. **Policy and orchestration:** deterministic policy enforcement remains authoritative. Model outputs are untrusted suggestions.
3. **Specialist adapters:** each model is behind a typed, versioned interface with explicit timeout, resource limits, health state, and failure semantics.
4. **Reasoning layer:** use the configured local Ollama/Qwen path or separately configured reasoning providers only when the task requires reasoning.
5. **Persistence:** PostgreSQL remains the source of truth; pgvector stores versioned embeddings. Record model/checkpoint/version and provenance for derived results.
6. **Human approval:** consequential actions remain gated by the existing authorization and review process.

No specialist may receive shell, filesystem-write, credential, deployment, or unrestricted MCP access merely because it was selected by a router.

## Adoption order

### Stage 0 — prerequisites

- Complete and verify the local inference adapter and exact-head CI for PR #864.
- Verify a real Ollama process and installed model on a disposable/local environment; do not infer runtime health from environment variables.
- Establish available CPU, RAM, GPU/VRAM, disk, and acceptable latency budgets.
- Confirm attachment ownership, malware scanning, quarantine, signed-read, retention, and audit controls for every new media-processing path.
- Create a small, access-controlled, representative evaluation corpus with redacted or synthetic test data.

### Stage 1 — low-risk offline evaluations

Run GLiNER extraction and EmbeddingGemma retrieval as offline benchmark jobs. Do not alter live memory writes or the active vector index.

- GLiNER output must be schema-validated, confidence-calibrated, and stored as derived data with source spans and provenance.
- EmbeddingGemma must use query/document task prompts consistently. Benchmark against the current embedding model using a separate versioned collection/index. Do not mix vectors from different embedding models in one similarity space.

### Stage 2 — document and media pilots

Evaluate PaddleOCR-VL only after the secure attachment pipeline is verified for the relevant document tables and ownership relationships. Process quarantined copies in an isolated worker with bounded file size, page count, memory, CPU/GPU time, and execution timeout.

Evaluate Parakeet and Kokoro on separately consented test audio. Keep the existing multilingual path available. A language selector or model-card language claim is not proof of quality for en-ZA or ve-ZA.

### Stage 3 — routing and decision support

Keep deterministic routing as the production baseline. Evaluate Arch-Router only after legal review and against a labelled intent-routing dataset. Any model route must be checked against an allowlisted route catalogue and deterministic authorization policy.

Do not introduce Nemotron-Orchestrator-8B into production under the research-only terms stated in the article.

### Stage 4 — controlled promotion

Promote one specialist at a time behind a feature flag, with a documented rollback path. Require exact-checkpoint licence review, reproducible evaluation, security review, monitoring, and owner approval. No automatic model downloads or production activation.

## Benchmark protocol and acceptance gates

Use a held-out, representative RyanAI dataset. Compare the specialist with the currently used implementation and a simple baseline. Record hardware, quantization, model revision, runtime/library versions, prompts, dataset version, warm/cold latency, throughput, peak memory, failure rate, and cost per successful task.

| Workload | Quality measures | Additional operational measures |
| --- | --- | --- |
| ASR | Word error rate (WER), character error rate (CER), named-term accuracy | Real-time factor, p50/p95 latency, language-specific results |
| OCR/document parsing | CER, field-level precision/recall/F1, table structure accuracy | Pages/minute, peak memory, timeout and malformed-file rate |
| Entity extraction | Exact-span precision/recall/F1 by entity type; calibration | False-positive rate, provenance completeness |
| Embeddings/retrieval | Recall@k, nDCG@k, MRR, human relevance judgement | Index size, embedding latency, migration/rebuild cost |
| Routing | Macro-F1, per-route precision/recall, confusion matrix, safe abstention rate | p50/p95 latency, invalid-route rate |
| Decisions/tool selection | Task success, policy violation rate, unnecessary tool calls | Escalation rate, cost per completed task |
| TTS | Blinded human intelligibility/naturalness ratings, pronunciation error rate | Real-time factor, startup latency, memory use |

**Minimum promotion gates:**

- No critical security, privacy, licence, or authorization failure.
- No model-generated authorization; all consequential actions still pass deterministic policy checks.
- Quality is non-inferior to the current baseline on every critical task slice; improvements must be statistically and operationally meaningful.
- A cost or latency improvement must be measured end-to-end, not inferred from parameter count.
- Explicit abstention/fallback for unsupported languages, low confidence, malformed output, timeouts, and unavailable models.
- Reproducible tests and monitoring for model version, latency, error rate, quality drift, and fallback frequency.
- Human review of extracted or generated content where incorrect output could cause consequential harm.

For retrieval, do not promote a new embedding model unless the held-out retrieval quality improves or remains non-inferior and the operational migration cost is justified. Preserve old index versions until rollback is verified.

## Operational and security requirements

- Treat model files, model cards, prompts, outputs, and retrieved documents as untrusted input.
- Pin model revisions and dependency versions; verify hashes where available.
- Run each heavyweight specialist in its own isolated environment/container to avoid NeMo, Paddle, PyTorch, and Transformers dependency conflicts.
- Do not download weights at API startup. Use an explicit, reviewed provisioning step and record model provenance.
- Apply network egress restrictions, resource quotas, request limits, timeouts, and cancellation.
- Never log raw private communications, document contents, audio, signed URLs, or secrets by default.
- Persist only necessary derived fields, with source references, retention rules, and deletion propagation.
- A model outage must fail closed or use an explicitly approved fallback; never report a specialist as healthy merely because it is configured.
- No new paid infrastructure, deployment, provider credential, or secret changes are part of this proposal.

## Decision

Proceed with a documentation-first, offline evaluation programme. The first practical candidates are GLiNER, EmbeddingGemma, and PaddleOCR-VL, each in a separate controlled pilot. Parakeet and Kokoro remain language-gated experiments. Defer Arch-Router pending licence review and baseline comparison. Exclude Nemotron-Orchestrator-8B from production under the stated licence.

This standard authorizes evaluation and preparation only. It does not authorize live production activation, migrations, deployment, external communications, permission expansion, or autonomous promotion.
