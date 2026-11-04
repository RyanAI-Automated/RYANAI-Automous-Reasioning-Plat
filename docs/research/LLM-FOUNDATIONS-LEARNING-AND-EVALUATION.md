# LLM Foundations: Chapter-by-Chapter Learning and Evaluation Plan

**Source:** Tong Xiao and Jingbo Zhu, *Foundations of Large Language Models*, arXiv:2501.09223v4  
**Pinned edition:** 2026-10-08  
**Status:** Learning and offline experiment proposal; no model, route, dependency, secret, or runtime configuration is changed by this plan.

## Purpose

Translate the book's six subject areas into practical RyanAI learning outcomes and falsifiable engineering experiments. The book is foundational material, not proof that a particular provider or model is best for RyanAI.

## Six-chapter study plan

The chapter labels below follow the six subject areas in the v4 arXiv abstract. Use the pinned PDF's own section headings and page numbers when recording detailed notes; do not invent page references.

| Chapter / subject | Learning objectives | RyanAI application | Learning artefact |
| --- | --- | --- | --- |
| 1. Pre-training | Understand tokenisation, self-supervised objectives, representations, data quality, scaling and limitations of pretrained models | Explain model capabilities and limitations; document why model names and parameter counts are not capability evidence | Two-page concept map; glossary; data/provenance risk notes |
| 2. Generative models | Understand autoregressive generation, Transformer components, training/inference distinction, context limits and generation behaviour | Compare model families and serving requirements without assuming interchangeable outputs | Model-family comparison and a reproducible prompt/generation test set |
| 3. Prompting | Study instruction structure, demonstrations, context selection, prompt sensitivity and output constraints | Build versioned, task-specific prompts for NVIDIA, Qwen, Logic and Ollama-hosted models | Prompt regression suite with schema, grounding and injection tests |
| 4. Alignment | Understand instruction tuning, preference alignment, reward/safety trade-offs and limits of model alignment | Keep model alignment separate from deterministic authorization; test policy refusal and unsafe tool proposals | Threat-oriented alignment test matrix; Gen-X enforcement evidence |
| 5. Inference | Study decoding, KV cache, batching, throughput, latency and memory trade-offs | Compare local Ollama serving and remote provider calls under equal task conditions | Hardware/latency/cost benchmark report |
| 6. Reasoning | Study reasoning behaviours, inference-time computation, decomposition, verification and failure modes | Evaluate planning, structured reasoning, evidence use, abstention and cross-model verification | Held-out reasoning benchmark with error taxonomy and verifier analysis |

## Suggested study cadence

1. **Foundation pass:** read Chapters 1–2; produce the concept map and terminology notes.
2. **Interaction pass:** read Chapter 3; build prompt fixtures and schema-validation tests.
3. **Governance pass:** read Chapter 4; map alignment concepts to RIIP and test Gen-X independently of model output.
4. **Serving pass:** read Chapter 5; define comparable serving conditions and resource measurements.
5. **Reasoning pass:** read Chapter 6; create held-out reasoning tasks and analyse failure modes.
6. **Synthesis:** write a short engineering decision record linking each proposed change to a measured result, security review, rollback, and ZAR economics.

## RyanAI orchestration mapping

The existing NVIDIA, Qwen and Logic slots are reasoning-provider roles. Ollama is the local inference runtime/adapter and may host a chosen local model; it is not inherently a fourth reasoning brain. Keep these distinctions explicit in metrics and logs.

| Component | Proposed responsibility in evaluation | Concepts applied | Hard boundary |
| --- | --- | --- | --- |
| NVIDIA | Primary remote reasoning baseline on tasks already assigned to that role | Generative behaviour, prompting, inference and reasoning | Provider configuration is not authentication or runtime proof; no provider-specific privilege |
| Qwen | Independent secondary reasoning baseline and comparison candidate | Prompt sensitivity, reasoning consistency, alignment and inference | No automatic failover unless the fallback is explicitly configured and tested |
| Logic | Structured planning, decomposition and synthesis comparison where currently intended | Reasoning, verification, abstention and output constraints | Logic output is a proposal; it cannot authorize tools or actions |
| Ollama | Local inference execution path for a pinned local model | Serving, quantization, context, decoding, latency and resource efficiency | Local-only mode must not silently fall back to a cloud provider; daemon/model health must be tested separately |
| Gen-X | Deterministic authorization and policy enforcement outside all model roles | Alignment limitations, adversarial evaluation and trust boundaries | Models cannot weaken, bypass, or replace Gen-X |
| PostgreSQL / pgvector | Durable task/evaluation metadata and versioned retrieval experiments | Provenance, representations and retrieval evaluation | Keep each embedding model in a separate versioned index; never mix vector spaces |

Do not change current routing weights, provider priority, prompts in production, model revisions, Ollama model selection, credentials, or fallback behaviour as part of this study.

## Testable engineering proposals

Each proposal is an offline experiment first. Register its owner, dataset version, exact model revision, licence, runtime, hypothesis, metrics, security controls, and rollback before execution.

### E1 — Prompt robustness and schema compliance

- **Hypothesis:** a shared, versioned task contract with provider-specific formatting can improve structured-output validity without changing authorization semantics.
- **Compare:** current prompt baseline against the proposed prompt on identical held-out tasks across NVIDIA, Qwen, Logic, and an available Ollama model.
- **Measures:** schema-valid rate, task success, groundedness, abstention, injection susceptibility, p50/p95 latency, cost per accepted task.
- **Pass condition:** meaningful quality or reliability improvement; no increase in critical policy violations; all actions still independently checked by Gen-X.

### E2 — Cross-model reasoning and verification

- **Hypothesis:** a second independent model or deterministic verifier may catch a defined subset of reasoning errors at an acceptable cost.
- **Compare:** primary-only baseline against primary-plus-verifier on a labelled, held-out task set.
- **Measures:** error detection precision/recall, false-positive rate, final task quality, latency, provider failure sensitivity and ZAR/task.
- **Pass condition:** statistically and operationally meaningful reduction in critical errors without creating a new authorization path or unacceptable cost/latency.

### E3 — Local inference economics and resilience

- **Hypothesis:** an Ollama-hosted model may improve privacy, offline availability or cost for selected task families.
- **Compare:** local inference against the currently configured remote baseline under documented hardware, quantization, context and concurrency conditions.
- **Measures:** task quality by critical slice, warm/cold p50/p95, throughput, peak RAM/VRAM, timeout/failure rate, power/compute cost and ZAR per accepted task.
- **Pass condition:** a clearly defined workload benefits while quality remains non-inferior and local-only mode demonstrably does not fall back to cloud.

### E4 — Inference and context efficiency

- **Hypothesis:** bounded context selection and measured decoding settings can reduce latency/resource use without losing required evidence.
- **Compare:** current context/generation configuration against one controlled change at a time.
- **Measures:** answer quality, source coverage, omission rate, p50/p95, tokens, memory and ZAR/task.
- **Pass condition:** no critical evidence loss; measurable end-to-end improvement; reproducible configuration and rollback.

### E5 — Alignment and authorization separation

- **Hypothesis:** model-level refusal/alignment improves response quality, but deterministic authorization remains necessary to block prohibited actions.
- **Compare:** benign, ambiguous, prompt-injection and adversarial tool-proposal fixtures across all model slots.
- **Measures:** refusal quality, unsafe proposal rate, policy decision correctness, attempted bypass success (must be zero), audit completeness.
- **Pass condition:** zero successful authorization bypasses; Gen-X denies prohibited actions even when a model recommends or fabricates approval.

## Shared benchmark protocol

- Use the same versioned task set, task instructions, scoring rules and data split for every candidate.
- Use synthetic or redacted, access-controlled data; exclude secrets and private communications unless separately approved.
- Keep a held-out test split unavailable to prompt/model tuning.
- Record exact provider/model/checkpoint revision, endpoint class, runtime/library versions, quantization, prompt hash, hardware, concurrency, dataset hash and run timestamp.
- Report results per task family and critical language slice; never hide regressions behind an aggregate score.
- Include deterministic baselines and the current implementation. Do not use a candidate's own published benchmark as the sole adoption evidence.
- Count a successful task only if it passes quality, schema, provenance and policy checks without uncounted human correction.
- Calculate `cost_per_successful_task_ZAR` using attributable inference/provider charges, compute, electricity, storage, network, amortized hardware and operations.
- Publish raw aggregate results and reproducible run instructions; do not publish private test content.

## Security review checklist

- [ ] Model and prompt inputs treated as untrusted.
- [ ] No model can grant permissions, approve changes, merge or deploy.
- [ ] Gen-X checks every protected action at the execution boundary.
- [ ] Provider credentials remain server-side and are not exposed in logs or benchmark artefacts.
- [ ] Local model files and runtime dependencies are pinned, provenance-checked and scanned.
- [ ] Local inference is isolated with bounded CPU, RAM/VRAM, disk, process, time and network egress.
- [ ] Timeouts, cancellation, malformed output, low confidence and provider outages have explicit failure/fallback behaviour.
- [ ] Evaluation data has owner approval, minimisation, retention and deletion controls.
- [ ] Model licence and exact checkpoint terms are reviewed before any weight download or redistribution.
- [ ] Rollback to the known-good model, prompt and route is tested.

## Promotion gates

A proposal may move beyond offline evaluation only when all of the following are evidenced:

1. Exact-commit CI and required security checks complete successfully.
2. Reproducible held-out results demonstrate meaningful benefit or justified non-inferiority.
3. No critical privacy, licence, security, data-ownership or authorization failure.
4. ZAR cost per accepted successful task and operational burden are justified.
5. Fallback and rollback are tested.
6. Human review approves the exact model revision, task scope, environment and change.

**This plan does not authorize model downloads, live traffic changes, provider activation, secrets changes, database migrations, deployments, paid infrastructure, or production promotion.**
