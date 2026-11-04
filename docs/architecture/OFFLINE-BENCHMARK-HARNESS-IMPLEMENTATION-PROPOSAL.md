# RyanAI Offline Benchmark Harness — Implementation Proposal

**Status:** Proposal for human review only  
**Scope:** Design and acceptance contracts; no benchmark implementation or model execution is authorised by this document  
**Applies to:** NVIDIA primary, Qwen secondary, Logic verification, and Ollama local inference adapter  
**Decision authority:** Human approval under Gen-X policy; model output is never an approval signal

## 1. Purpose and non-goals

This proposal defines a reproducible, isolated benchmark system for comparing the four RyanAI inference paths only after six independent readiness gates have passed.

The first deliverable is this proposal. Review and explicit approval of the design must occur before implementing the runner or invoking any model.

This proposal does not:
- invoke a model, download weights, or run a comparison;
- change production routing, prompts, provider configuration, secrets, or model registry status;
- write to production PostgreSQL/pgvector or any production service;
- merge existing PRs, deploy services, or authorise production activation;
- treat a configured provider, reachable endpoint, or passing mock test as proof of model health.

Ollama is evaluated as the local inference runtime/adapter. It is not counted as a fourth independent model provider or reasoning brain unless a separately governed model identity is pinned and documented.

## 2. System boundary and isolation design

### 2.1 Proposed topology

The benchmark runner is a separate, short-lived process/container with its own read-only benchmark package and disposable output directory:

```text
Human-approved benchmark specification
              |
              v
  Isolated benchmark controller
   |          |             |
   |          |             +--> Evidence writer (append-only run bundle)
   |          |
   |          +--> Evaluator / scorer (outside model-visible workspace)
   |
   +--> Dataset broker
          |-- development set (runner-readable)
          |-- held-out set (evaluator-only; no model/agent access)

Isolated adapter boundary
   |-- NVIDIA adapter (disabled in local-only mode)
   |-- Qwen adapter (disabled in local-only mode)
   |-- Logic adapter (disabled in local-only mode)
   +-- Ollama adapter (explicit loopback allowlist only)

Independent Gen-X authorization test harness
   +--> policy decision oracle / test doubles
```

This is a logical design, not a claim that the isolation currently exists.

### 2.2 Network and credential controls

- Default mode is **offline/local-only**. Network egress is denied at the operating-system/container boundary, not merely by a prompt or application flag.
- The only permitted inference destination in local-only mode is an explicitly configured Ollama endpoint on an approved loopback address/port (normally 11434). The endpoint must be validated against the existing local endpoint allowlist.
- DNS resolution and outbound connections to public IPs, cloud provider domains, metadata endpoints, arbitrary LAN hosts, and unapproved ports must fail closed.
- No NVIDIA, Qwen, Logic, OpenAI-compatible gateway, or other provider credentials are mounted into the local-only runner. Credential absence is an enforced precondition, not just a configuration convention.
- If Ollama is unavailable, has an invalid endpoint, or cannot load the pinned model, the run fails. It must not fall back to a cloud provider.
- Cloud-provider comparisons, if ever separately approved, require a distinct explicit mode, separate credentials boundary, separate cost controls, and a separate approval. They are not part of this offline/local-only gate.
- The runner receives no production `.env`, production database URL, deployment token, GitHub write token, or general-purpose host mount.
- The runner has no write access to source code, production data, model registry, or policy configuration. Its only writable location is a fresh run-specific evidence directory.
- Apply CPU, memory, GPU, process, file-size, wall-clock, and request-count limits. Terminate the run on limit violation.
- Capture attempted egress and blocked connection evidence. A successful application-level “offline” flag alone is insufficient.

### 2.3 Isolation acceptance tests

Before any real model is invoked, test with local mock endpoints and network probes:
1. public DNS and public-IP connection attempts are blocked;
2. cloud-provider hostnames and known provider endpoints are blocked;
3. arbitrary LAN hosts and unapproved ports are blocked;
4. only the approved Ollama loopback endpoint can be reached in local-only mode;
5. missing Ollama, malformed endpoint, timeout, and model-not-found conditions fail closed;
6. no provider credential or production secret is present in the runner environment or mounted files;
7. the runner cannot reach production databases, deployment APIs, or repository write APIs;
8. all attempted and denied connections are recorded without leaking secrets.

The isolation gate fails if any unapproved egress succeeds, any cloud fallback occurs, or the test cannot establish the effective network boundary.

## 3. Dataset structure and protection

### 3.1 Proposed layout

```text
benchmarks/
  README.md
  schemas/
    task.schema.json
    rubric.schema.json
    run-manifest.schema.json
    result.schema.json
  datasets/
    development/
      manifest.json
      tasks/
        reasoning.jsonl
        factuality.jsonl
        tool-use.jsonl
        safety.jsonl
        en-ZA.jsonl
        ve-ZA.jsonl
    heldout/                 # evaluator-controlled; never mounted for model access
      manifest.json          # public metadata only; no task contents or answers
  prompts/
    benchmark-system.txt
    task-templates/
  contracts/
    adapter.contract.md
    isolation.contract.md
    scoring.contract.md
    genx-authorization.contract.md
  evidence/
    README.md
    examples/                # synthetic examples only
```

This is a proposed structure. The held-out directory must be protected by repository permissions or stored in a separate evaluator-controlled location; a folder name or gitignore rule is not a security boundary.

### 3.2 Task record contract

Each task record should have a stable opaque ID and include:
- task family and difficulty band;
- locale/language slice (including en-ZA and ve-ZA where suitable);
- input payload and allowed context;
- expected output schema and deterministic assertions, where applicable;
- rubric identifier for qualities requiring human judgement;
- safety/policy tags and expected abstention or refusal behaviour;
- tool permissions and allowed side effects (default: none);
- dataset version and provenance metadata.

Do not place hidden answers, scoring keys, evaluator-only prompts, or held-out labels in model-visible context. Avoid personal, confidential, or production-derived data unless separately authorised, minimised, and de-identified.

### 3.3 Dataset lifecycle and anti-leakage

- Freeze a versioned development dataset before a run; compute SHA-256 hashes for every file and the complete dataset manifest.
- Keep held-out task contents, reference answers, rubrics with hidden criteria, and evaluator keys outside the model/agent workspace and runner mounts.
- The evaluator alone retrieves held-out material after candidate outputs are sealed.
- Record every held-out access with actor, purpose, timestamp, dataset version and result. Models and agents receive no read, list, search, or indirect retrieval access.
- Separate development, calibration and final held-out sets. Do not tune prompts or model settings against final held-out feedback.
- Rotate or refresh held-out tasks if leakage is detected. Preserve prior run records and mark compromised evaluations invalid rather than silently replacing results.
- Include adversarial prompt-injection and instruction-conflict cases, but do not reveal their hidden expected outcomes to the evaluated model.

### 3.4 Dataset acceptance evidence

Required: version identifiers, file hashes, task counts by family/language, provenance statement, contamination review, access-control proof, access audit, and a test showing model-visible inputs contain no held-out labels or scoring oracle.

## 4. Adapter and test contracts

All adapters implement the same versioned interface. A model response is untrusted data.

### 4.1 Adapter contract

Conceptual interface:

```ts
type BenchmarkRequest = {
  runId: string;
  taskId: string;
  input: unknown;
  deadlineMs: number;
  maxOutputTokens: number;
};

type BenchmarkResponse = {
  output: unknown;
  modelIdentity: string;
  immutableRevision: string;
  runtimeIdentity: string;
  finishReason: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

interface BenchmarkAdapter {
  describe(): Promise<{
    provider: string;
    model: string;
    immutableRevision: string;
    runtimeVersion: string;
    capabilities: string[];
  }>;
  invoke(request: BenchmarkRequest): Promise<BenchmarkResponse>;
  close(): Promise<void>;
}
```

The contract is illustrative and must be refined during implementation review. The adapter must not have access to datasets, evaluator keys, Gen-X policy mutation, secrets beyond its specifically approved adapter boundary, or evidence deletion.

### 4.2 Required adapter contract tests

- identity and immutable revision are present and match the run manifest;
- request and response schemas validate;
- timeout, cancellation, rate-limit, malformed output, empty output and transport errors are surfaced distinctly;
- no implicit retries that duplicate side effects; retries are bounded and recorded;
- no provider fallback or cross-adapter routing;
- adapter cannot read held-out data or scorer internals;
- output is treated as untrusted text/data, never executable instructions;
- tool calls are disabled by default; any future tool benchmark uses a separate least-privilege sandbox;
- exact prompt/template and configuration hashes are attached to each result;
- mock tests prove contract behaviour without invoking a real model.

### 4.3 Four-way comparison identity

A comparison is valid only if each evaluated path has a pinned identity:
- NVIDIA: exact provider model identifier and immutable provider revision/snapshot, if exposed;
- Qwen: exact model identifier and immutable revision/digest;
- Logic: exact model/provider identifier and immutable revision/digest;
- Ollama: exact local model name plus immutable model digest, quantisation, Ollama runtime version and serving configuration.

If a provider cannot expose an immutable revision, record that limitation and mark the run non-comparable until an acceptable pinning method is approved. A mutable alias such as `latest` is not sufficient.

## 5. Scoring and human review

### 5.1 Deterministic scoring

Use versioned machine-checkable assertions for:
- schema and format validity;
- exact constraints and required fields;
- arithmetic or other objectively verifiable outputs;
- task-specific correctness checks with declared tolerances;
- tool-call shape and permission compliance;
- explicit abstention/refusal expectations;
- prohibited output and policy-violation detection.

Every assertion has a stable ID, version, pass/fail/indeterminate result, and diagnostic. Do not collapse missing evidence into a pass.

### 5.2 Human-reviewed criteria

Reviewers use a versioned rubric for:
- reasoning validity and relevance;
- factual grounding and unsupported-claim rate;
- completeness and clarity;
- appropriate uncertainty and abstention;
- safety, privacy, and instruction-hierarchy compliance;
- South African English (en-ZA) and Tshivenda (ve-ZA) quality where applicable.

Use blinded candidate labels and independent reviewers for safety-critical slices. Record reviewer identity or approved pseudonymous ID, rubric version, score, rationale, disagreement and adjudication. Human review must not be replaced by another evaluated model.

### 5.3 Reporting rules

- Report per-task and per-slice results, sample sizes and confidence intervals where meaningful.
- Show failures, refusals, abstentions, timeouts and missing outputs explicitly.
- Do not let aggregate averages conceal a critical safety or language regression.
- A quality or safety regression blocks promotion to the next evaluation stage regardless of speed.
- Keep raw outputs access-controlled and redact sensitive content in summary reports.

## 6. Performance, reliability and ZAR economics

Measure each run with the same hardware, runtime limits, warm-up policy, concurrency, dataset version and prompt/configuration hashes.

Required measurements:
- end-to-end latency: p50, p95, p99 where sample size permits;
- time-to-first-token and generation throughput where supported;
- completed tasks per unit time and concurrency;
- success, failure, timeout, cancellation and abstention rates;
- CPU, RAM, GPU utilisation, peak VRAM and peak memory;
- model load time, cold-start and warm-run performance;
- energy consumption if a reliable meter is available;
- human review and correction time;
- cost per accepted task in South African rand (ZAR).

Define **accepted task** before the run: a completed task that passes required deterministic assertions and the applicable human quality/safety rubric. Denominator must not silently exclude failed, timed-out or refused tasks; report both cost per attempted task and cost per accepted task.

For local inference, report measured electricity consumption and the declared tariff, plus an explicitly stated hardware amortisation method if included. If a cost component cannot be measured reliably, mark it unavailable and show the formula/assumption separately—never invent a precise cost. For any separately approved cloud evaluation, include actual billed usage and exchange-rate source/date; do not include cloud calls in an offline run.

## 7. Independent Gen-X authorization verification

Gen-X remains the independent authorization enforcement authority. Neither model output nor Jarvis may grant permissions, approve their own changes, change policy, merge, deploy, or override approval requirements.

Test Gen-X outside the model response path using adversarial inputs and direct authorization checks:
1. model says “approved” or fabricates a human approval;
2. prompt injection asks to reveal secrets or bypass policy;
3. output requests a privilege escalation or changes its own role;
4. model requests a forbidden tool/action or exceeds granted scope;
5. replayed, stale, forged or tampered approval evidence is presented;
6. model attempts to modify policy, audit records, or its own authorization state;
7. policy service is unavailable, times out, or returns malformed data;
8. action is valid but the human approval is absent, expired, or for a different target.

Acceptance: authorization is decided by Gen-X and required human approval outside the model's control; default is deny on missing, invalid, stale or unavailable policy evidence; all decisions are auditable. Tests must demonstrate that a model's textual claims cannot change the authorization result.

## 8. Evidence bundle format

Each run produces a self-contained, immutable evidence bundle. Suggested layout:

```text
run-<UTC timestamp>-<run-id>/
  manifest.json
  environment.json
  dataset-manifest.json
  prompt-config-hashes.json
  isolation/
    policy.json
    egress-test-results.json
    blocked-connection-log.json
  adapters/
    identity.json
    contract-test-results.json
  results/
    task-results.jsonl
    deterministic-scores.json
    human-review.jsonl
    aggregate-metrics.json
  genx/
    adversarial-test-results.json
  resources/
    telemetry.jsonl
    cost-breakdown-zar.json
  logs/
    runner.log
    redaction-report.json
  checksums.sha256
  report.md
```

Minimum manifest fields:
- schema and harness version;
- repository, commit SHA and clean/dirty working-tree state;
- runner image digest, OS, dependency lockfile hash and runtime versions;
- adapter/provider/model identity, immutable revision and quantisation;
- Ollama version and model digest when applicable;
- prompt/system-template hashes and non-secret config hash;
- development and held-out dataset version/hash references (no held-out contents);
- hardware identity and declared resource limits;
- run mode (offline/local-only or separately approved cloud mode);
- start/end times, task counts and termination reason;
- scorer/rubric versions and reviewer records;
- isolation test result, Gen-X test result and all gate verdicts.

Each task result includes task ID, adapter identity, request/response hashes, timestamps, measured durations, actual token usage only when returned by the runtime/provider, resource samples, deterministic assertion outcomes, review status, failure/abstention category and redaction status. Never estimate token counts and label them as measured.

Generate a SHA-256 checksum manifest after the run. Store evidence in an access-controlled location with append-only or immutable retention where available. Evidence integrity does not itself prove the underlying measurements are truthful; retain the test procedures and independent verification results.

## 9. Six independent readiness gates

All six gates are conjunctive. Each has an owner, test procedure, evidence artifact and explicit pass/fail/blocked verdict. Unknown or missing evidence is **not passed**.

| Gate | Independent pass condition | Required evidence |
|---|---|---|
| 1. Offline isolation | Egress denied by OS/container boundary; only approved local Ollama endpoint reachable; no cloud fallback or secrets | Network policy, positive/negative egress tests, environment/mount audit, blocked-connection logs |
| 2. Dataset integrity | Frozen development set; evaluator-controlled held-out set inaccessible to model/runner; anti-leakage checks pass | Dataset hashes, provenance, access controls/logs, contamination review |
| 3. Provenance | Every candidate, runtime, prompt, config, dataset and harness revision pinned and reproducible | Complete manifest, immutable model digests/revisions, lockfile and SHA-256 hashes |
| 4. Scoring validity | Deterministic assertions validated; human rubric and blinded review process defined; safety slices cannot be averaged away | Scorer tests, rubric version, reviewer protocol, calibration/adjudication evidence |
| 5. Performance/economics | Metrics instrumented and reproducible; failures included; ZAR cost formula and accepted-task denominator fixed | Raw telemetry, repeatability checks, task accounting, cost breakdown and assumptions |
| 6. Gen-X authorization | Authorization is independent of model output and fails closed under adversarial and outage tests | Adversarial test matrix/results, policy decision traces, audit evidence |

Gate owners must attest independently. A single overall green indicator cannot replace the six individual verdicts.

## 10. Implementation sequence after proposal review

1. **Review this proposal.** Resolve design comments and obtain explicit human approval to implement the harness. No model is invoked during this step.
2. **Implement schemas and mock-only contracts.** Add dataset/result/manifest schemas, adapter interface, fake adapters, scorer unit tests and evidence writer. No model downloads or real inference.
3. **Prove isolation.** Build the restricted runner and demonstrate egress denial, secret absence, filesystem restrictions and fail-closed behaviour using mocks/probes only.
4. **Protect datasets.** Establish the development set and evaluator-controlled held-out workflow, hashes and access audit.
5. **Validate provenance, scoring and measurement.** Use synthetic fixtures and mock adapters to test repeatability, metrics, review workflow and ZAR accounting.
6. **Run independent Gen-X adversarial tests.** Verify authorization boundaries without relying on evaluated model responses.
7. **Gate review.** Publish a six-row evidence matrix with each gate independently marked PASS, FAIL or BLOCKED. Any non-PASS blocks model invocation.
8. **Separate evaluation approval.** Only after all six gates pass and a human explicitly approves a named evaluation scope may the harness invoke the pinned candidate models. Evaluation approval does not authorize production routing, activation, merge or deployment.

## 11. Explicit stop conditions

Stop and mark the run invalid or blocked if:
- any unapproved network egress succeeds;
- any cloud fallback occurs in local-only mode;
- a model or agent accesses held-out content or evaluator keys;
- any model identity, prompt, config, dataset or harness revision is unpinned;
- evidence is incomplete, mutable without audit, or fails checksum verification;
- a critical safety or Gen-X authorization test fails;
- a task failure is hidden, misclassified, or excluded from the denominator;
- production secrets, databases, routing or services are reached or modified.

No automatic retry may turn a failed gate into a pass. Fixes require new tests and a new evidence record.

## 12. Review checklist and decision record

Reviewers should explicitly accept or request changes to:
- [ ] process/container isolation and network-deny strategy;
- [ ] Ollama-only local endpoint exception and no-fallback behaviour;
- [ ] dataset schema, held-out custody and anti-leakage controls;
- [ ] adapter identity and immutable revision requirements;
- [ ] deterministic assertions and human review rubric;
- [ ] performance, resource and ZAR cost definitions;
- [ ] Gen-X adversarial test matrix and fail-closed semantics;
- [ ] evidence bundle, integrity and retention controls;
- [ ] implementation sequence and stop conditions.

**Decision record:**  
- Proposal review: PENDING  
- Implementation approval: NOT GRANTED  
- Six readiness gates: NOT RUN  
- Model invocation/comparison: NOT AUTHORISED  
- Production activation, merge or deployment: NOT AUTHORISED


## 13. Repository-backed provider and environment audit (2026-11-04)

This section supersedes any earlier wording that implies NVIDIA, Qwen, or Logic are unavailable or that all four paths can be tested under one offline profile. The repository already contains a GitHub Actions provider-verification path and provider-specific configuration. The user has confirmed that the relevant environments are available. This audit reads configuration names and code paths only; it does not read secret values or invoke a provider.

### 13.1 Existing GitHub Actions access path

`.github/workflows/provider-verification.yml` references the GitHub Actions environment `ryanai-provider-verification` and defines independent `primary`, `secondary`, and `logic` matrix entries. Its workflow mapping is:

- NVIDIA primary: `secrets.NVIDIA_API_KEY`
- Qwen secondary: `secrets.QWEN_API_KEY`
- Logic: `secrets.LOGIC_API_KEY`, with `secrets.OPENAI_API_KEY` as a fallback
- Selected credential is passed to the probe process as `PROVIDER_API_KEY`.
- Endpoint and model selectors are supplied through Actions variables: `NVIDIA_API_ENDPOINT`, `QWEN_API_ENDPOINT`, `LOGIC_API_ENDPOINT`, `PRIMARY_REASONING_MODEL`, `SECONDARY_REASONING_MODEL`, and `LOGIC_REASONING_MODEL`.

The workflow references the environment, but this repository read does not expose or verify secret values. Secret values must never be printed into logs or evidence. Do not ask the user to recreate these settings.

**Important:** this workflow is a live connectivity probe, not the benchmark harness. `scripts/provider-live-probe.mjs` constructs a `ChatOpenAI` client and sends the `RYANAI_BRAIN_READY` challenge, then writes a health record to its disposable CI PostgreSQL service. It can invoke a real provider. It must not be dispatched or otherwise triggered as a substitute for mock-only gate tests. A push to its configured branch can also trigger it; avoid unrelated pushes to `main` while preserving this workflow's existing behaviour. No provider probe was run as part of this audit.

### 13.2 Actual implementation identity

Repository code establishes the following:

- **NVIDIA primary:** `src/config/brains.ts` constructs a dedicated `ChatOpenAI` client. Its default model is `nvidia/nemotron-3-ultra-550b-a55b`; its default endpoint is NVIDIA's `https://integrate.api.nvidia.com/v1`. Model and endpoint are configurable through `PRIMARY_REASONING_MODEL`, `NVIDIA_MODEL`, and `NVIDIA_API_ENDPOINT`.
- **Qwen secondary:** a separate `ChatOpenAI` client is constructed. Its default model is `Qwen/Qwen3-235B-A22B-Instruct-2507-tput`; its default endpoint is `https://api.together.xyz/v1`, with `QWEN_API_ENDPOINT` override. The configured path may therefore use Together as the serving endpoint for a Qwen model; provider/model identity must record both separately.
- **Logic:** `logicBrain` is also a model-backed `ChatOpenAI` client, not a deterministic verifier. Its default model is `gpt-4o-mini` and default endpoint is `https://api.openai.com/v1`; `LOGIC_REASONING_MODEL`, `LM_STUDIO_MODEL`, `OPENAI_MODEL`, `LOGIC_API_ENDPOINT`, and `OPENAI_BASE_URL` can change that identity. It is used as the planning/structured-decomposition stage in `src/engine/graph.ts` and `src/engine/orchestrator.ts`. Therefore it is both a separately configurable model-backed path and a component of a composite Logic → NVIDIA → Qwen pipeline. Benchmark the Logic model path separately, and report the complete pipeline as a distinct composite system; do not conflate the two.
- **Ollama:** it is a runtime/adapter, not a model identity. The actual `OLLAMA_MODEL` value, model digest, quantisation, runtime version, and serving configuration must be captured at evaluation time.

### 13.3 Configuration consistency blocker

There are multiple model inventories. `src/config/models.ts` declares Qwen entries including `qwen/qwen-3.6-27b` and `qwen/qwen-2.5-72b-instruct`, while `src/config/brains.ts` and the provider probe resolver default the secondary brain to `Qwen/Qwen3-235B-A22B-Instruct-2507-tput`. These are not the same model identity. Before evaluation, select the authoritative configured model per path, resolve the discrepancy without changing production routing, and freeze the exact model, serving provider, endpoint, immutable revision (or documented provider limitation), and prompt/configuration hashes. Do not infer which model is currently active from a default alone.

### 13.4 Two explicit execution profiles

**Profile A — strict offline/local-only**

- Ollama/local candidate only.
- No NVIDIA, Qwen, Logic, OpenAI, Together, gateway, or other remote provider credentials in the runner.
- Deny public and arbitrary LAN egress at the OS/container/network boundary.
- Permit only the exact isolated Ollama destination (address, port, and protocol) using a dedicated network namespace/bridge with firewall-enforced deny-by-default rules, or an equivalently narrow local IPC boundary.
- `host.docker.internal` and Docker service aliases are not loopback and are not proof of isolation. The current application allowlist is not a substitute for network enforcement.
- Missing model, endpoint, or runtime fails closed; no cloud fallback.

**Profile B — separately approved remote-provider evaluation**

- Uses the existing `ryanai-provider-verification` GitHub Actions environment and the existing provider-specific secret/variable mappings described above; do not create duplicate credentials or request that the user re-enter them.
- This profile is explicitly **remote-provider evaluation**, not offline. It must run in a dedicated, short-lived job with an explicit provider selection, exact hostname/port/protocol allowlist derived from the pinned endpoint, TLS verification, no arbitrary URL override, no fallback, and no access to production databases, deployment credentials, or unrelated repository secrets.
- Enforce request-count ceilings, concurrency limits, timeouts, maximum output tokens, and a hard per-run ZAR spend ceiling before any call. If the spend ceiling or actual provider price is unknown, the profile is BLOCKED and makes zero calls.
- Record the selected provider, endpoint host (never credential-bearing URL), model identity, secret *name* used (never its value), request count, actual returned usage, billed cost if available, and failure classification.
- A Profile A isolation PASS does not pass Profile B isolation. Profile B requires its own negative-egress, destination-allowlist, credential-scope, no-fallback, and spend-limit evidence.

The six readiness gates remain conjunctive, but every verdict must be labelled with its profile. Gate 1 must have separate results for A and B. Remote model comparisons require all six gates to pass for Profile B and a separate explicit evaluation-scope approval. A pass for Ollama under Profile A does not imply that NVIDIA, Qwen, or Logic were evaluated.

### 13.5 Pre-registered evaluation protocol

Before the first model invocation, freeze and hash the evaluation protocol. Proposed starting defaults for review (not execution authorization) are:

- At least 50 tasks per task-family/language slice; publish counts and confidence/uncertainty intervals.
- Three repetitions per task for stochastic/reliability measurement; deterministic assertions run on every repetition.
- Five warm-up requests per candidate, excluded from quality scoring but retained in resource/latency logs.
- Baseline concurrency of one; any higher-concurrency stress run is a separate labelled experiment.
- Per-request timeout of 60 seconds and a maximum output budget of 2,048 tokens unless a task-specific contract declares a lower limit.
- Two independent blinded human reviewers for safety-critical and reasoning-quality slices; target inter-reviewer agreement of at least 0.70 using a declared statistic, with adjudication by a third reviewer when below threshold.
- Zero tolerance for a confirmed Gen-X authorization bypass, secret disclosure, or disallowed consequential action.
- Report all attempted tasks, refusals, timeouts, errors, and missing outputs; never remove them from denominators.
- Profile A has no provider spend. Profile B has no default spend allowance: a numeric ZAR ceiling, provider pricing source/date, and user approval must be recorded before the first request.

The proposal must identify the protocol owner, dataset custodian, isolation/security reviewer, scoring lead, economics reviewer, Gen-X policy owner, and human approver by role and record their attestations in the evidence bundle. Missing owners, missing thresholds, or missing evidence mean BLOCKED, not PASS.

### 13.6 Revised gate evidence matrix

For each selected profile, each of the six gates must record: profile ID, named owner, exact procedure and version, evidence artifact/hash, independent attestation, timestamp, and PASS/FAIL/BLOCKED. Profile B additionally requires proof of endpoint allowlisting, provider-secret scoping, request/spend ceilings, and no-fallback behaviour. The Logic model path and the composite Logic → NVIDIA → Qwen pipeline must have distinct identities and result rows.

**Current status after repository inspection:** provider workflow/configuration paths are present; no secret values were read; no provider challenge or benchmark model was invoked; no gate has been executed by this audit; actual active model values/revisions and remote spend ceiling remain unverified. This documentation correction does not approve harness implementation, model invocation, spend, production routing, merge of runtime changes, or deployment.
