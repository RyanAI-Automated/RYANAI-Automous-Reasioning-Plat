# TwIL-8B evaluation adapter (non-production)

## Status

TwIL-8B is a candidate specialist model only. This adapter is deliberately not imported by the production orchestrator, brain registry, API startup, or memory pipeline. No model weights are downloaded at startup. There is no automatic fallback or promotion path.

**Licence gate:** the source article and upstream release describe a webAI non-commercial licence. This implementation permits only explicitly acknowledged, non-commercial evaluation. It is not approval for commercial use, hosted customer workloads, or production deployment. Legal review must confirm the actual licence text and any redistribution/derivative restrictions before evaluation begins. If the licence does not permit the intended evaluation, do not download or run the weights.

## Runtime isolation

The adapter talks only to an approved local OpenAI-compatible inference server (localhost/loopback/host.docker.internal, port 8080 or 11434). It rejects remote endpoints, URL credentials, query strings, unsupported ports, and production environments. It does not read NVIDIA/Qwen/Logic credentials, access PostgreSQL/pgvector, write memory, execute tools, or log prompts/completions.

Set all gates explicitly in a disposable evaluation environment:

- `RYANAI_TWIL8B_EVALUATION=enabled`
- `RYANAI_TWIL8B_LICENSE_ACK=non-commercial-evaluation-only`
- `TWIL8B_ENDPOINT=http://127.0.0.1:8080/v1` (or an approved local endpoint)
- `TWIL8B_RUNTIME_MODEL=<the exact alias loaded by the local inference server>`
- `TWIL8B_MODEL_REVISION=<40/64-character pinned commit or SHA-256 revision>`
- `TWIL8B_VARIANT=balanced` or `verbose`
- Optional: `TWIL8B_MAX_OUTPUT_TOKENS=8192` (integer 1–32768)

Run balanced and verbose as separate, pinned model-server sessions. Record the exact weight revision, quantisation, runtime/server version, hardware, prompt-set hash, generation settings, and result artifact. Do not compare variants while silently changing any other variable.

## Evaluation protocol

Use the same frozen, decontaminated, held-out prompt set and scoring harness for TwIL-8B, NVIDIA, Qwen, and Logic. Record per-task correctness/pass rate, instruction adherence, code test pass rate, refusal/abstention and failure rates, p50/p95 latency, output tokens, peak RAM/VRAM, energy/cost per successful task, and human correction cost. Preserve raw outputs only in an access-controlled evaluation workspace with retention limits; redact private payloads and secrets from reports.

Required slices include math, code, general reasoning, instruction following, knowledge/science, en-ZA, and ve-ZA where suitable validated datasets exist. Report dataset availability and sample counts; do not fabricate scores for unavailable slices. Use repeated runs where sampling is nondeterministic and report confidence intervals. The publisher's MATH-500/AIME/LiveCodeBench figures are claims to reproduce, not RyanAI baseline results.

## Promotion and rollback gates

1. Confirm the exact upstream licence and evaluation rights.
2. Confirm hardware capacity and local isolation before loading weights.
3. Pin and hash the exact model files and inference runtime.
4. Establish baselines for existing NVIDIA/Qwen/Logic candidates.
5. Run balanced and verbose independently on the same held-out suite.
6. Pass security, privacy, licence, quality non-inferiority, cost, and rollback reviews.
7. Publish reproducible evidence and obtain explicit human approval for any future change.

This PR does not add TwIL-8B to production routing, does not alter PostgreSQL/pgvector memory, and does not modify existing brain orchestration. Removal is a file-level rollback: delete the isolated adapter, tests, documentation and candidate registry entry.

## Shared comparison harness

`src/inference/modelEvaluation.ts` exports `runModelComparison`. Supply the same frozen prompt-case array and at least two candidate callbacks (each with a pinned revision) to compare TwIL balanced/verbose with NVIDIA, Qwen, and Logic. Provider-specific callbacks must be supplied by the isolated evaluation runner; this harness does not create credentials or call provider APIs itself.

The report includes a SHA-256 digest of the canonical prompt dataset, candidate revisions, per-case latency, success/failure, optional exact/contains scoring, approximate output-token counts, output SHA-256 digests, and p50/p95 plus aggregate summaries. It intentionally excludes prompt and completion text and does not persist results. The approximate token count is a rough character-based estimate, not tokenizer usage. Capture actual provider billing, hardware/VRAM/RAM, energy, and human-correction measurements separately in the access-controlled evidence bundle.

For each run, retain the harness report together with the external dataset file hash, model-weight file hashes, server/runtime version, quantisation, hardware details, licence evidence, and scorer/dataset version. Run balanced and verbose in separate server processes so the selected weights are unambiguous. A supplied revision string is provenance metadata; the operator must independently verify it against the downloaded model revision and file hashes before accepting the run.
