# RyanAI Benchmark Operational Readiness

This phase is **mock-only**. It must not invoke NVIDIA, Qwen, Logic, Ollama, OpenAI, or any other model.

Missing, stale, unverifiable, or ambiguous evidence is UNKNOWN/BLOCKED, never PASS.

## Gate evidence contract

`benchmarks/contracts/gate-contracts.json` defines the minimum evidence required for each of the six independent gates.

## Profile A isolation boundary

The strict local profile permits inference traffic only to loopback Ollama:

- `http://127.0.0.1:11434`
- `http://[::1]:11434`

`host.docker.internal`, Docker service aliases such as `ollama`, arbitrary LAN addresses, public IPs, cloud domains, and unapproved ports are not accepted as proof of loopback isolation.

The benchmark runner must enforce this at the network/container boundary. Application-level flags alone are insufficient.

## Provider verification boundary

`.github/workflows/provider-verification.yml` performs real authenticated provider calls. It is therefore **manual-only** and must not run on `push` to `main`.

Provider verification is evidence about the live probe only. It is not benchmark-gate evidence and does not authorize benchmark execution.

## Provenance freeze

Before evaluation, the run manifest must pin the exact provider/model identifier, immutable revision or digest where supported, runtime version, prompt/template hashes, non-secret configuration hash, harness commit SHA, dataset version/hash, and Ollama model digest/quantisation for Profile A.

Mutable aliases such as `latest` are not acceptable.

## Qwen identity discrepancy

The repository currently contains multiple Qwen identities. `src/config/brains.ts` defaults the secondary brain to `Qwen/Qwen3-235B-A22B-Instruct-2507-tput` through Together, while `src/config/models.ts` contains `qwen/qwen-3.6-27b`, `qwen/qwen-2.5-72b-instruct`, and `qwen/qwen-2.5-coder-32b-instruct`.

Therefore no Qwen benchmark identity is frozen by this phase. The active evaluation identity must be selected and pinned before any model invocation.

## Existing non-compliant benchmark path

`src/analytics/benchmark.ts` directly invokes the three configured brain clients and persists telemetry to PostgreSQL. It is not the offline benchmark harness and must not be used for gate execution.

## Completion rule

Only after all six gates independently return PASS, with required evidence intact, may separate evaluation-scope approval be requested. Passing the gates does not authorize production activation, routing changes, merging, deployment, or provider spend.
