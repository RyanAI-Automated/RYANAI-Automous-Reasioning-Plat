# RyanAI OpenTelemetry agent observability and evaluation design

**Status:** proposed implementation contract; draft PR only  
**Date:** 2026-11-05  
**Scope:** repository-level design for consolidating existing OpenTelemetry code and adding privacy-safe agent traces and optional MLflow evaluation/export.

## Decision

Adopt OpenTelemetry as RyanAI's vendor-neutral tracing contract. Keep the existing TypeScript/Node runtime, provider adapters, PostgreSQL/pgvector memory, and Gen-X authorization boundary. Add an optional OTLP destination adapter for Databricks MLflow; do not make Databricks, Anthropic, or any single model provider a runtime dependency.

This is an incremental design, not a claim that tracing or MLflow integration is already operational.

## Repository findings

The initial source search found multiple telemetry implementations:

- `src/observability/telemetry.ts` creates a NodeSDK with an OTLP HTTP trace exporter and Node auto-instrumentation.
- `src/config/telemetry.ts` creates a second NodeSDK and falls back to console span export when no OTLP endpoint is configured.
- `src/telemetry.ts` exposes another initialization path.
- `package.json` contains a `telemetry:collect` script that preloads `src/telemetry.ts` for the MCP system server.

These are evidence of existing instrumentation scaffolding, not proof that all active API, agent, MCP, worker, and sandbox paths emit useful spans. The initial code search did not establish a single canonical lifecycle or a complete call-site map. The first code implementation must inventory imports, process entrypoints, SDK start/shutdown behavior, and existing tests before consolidating anything.

## Target architecture

1. **One SDK lifecycle per process.** A single canonical bootstrap module owns resource attributes, sampler, exporter, instrumentations, startup, flush, and shutdown. Importing a module must not unexpectedly start a second SDK or register competing signal handlers.
2. **Vendor-neutral OTLP.** Export traces through standard OpenTelemetry OTLP HTTP/protobuf configuration. The collector/destination is configurable. Databricks MLflow is one supported destination, not the only destination.
3. **Meaningful application spans.** Add explicit spans around agent runs, model requests, tool execution, retrieval, sandbox jobs, and evaluation runs. Preserve parent/child relationships and propagate trace context across supported async and service boundaries.
4. **Policy remains authoritative.** Gen-X and trusted application authorization enforce identity, scope, approval, and action policy. Trace spans record sanitized decision outcomes for diagnostics; telemetry must never become an authorization input or grant capability.
5. **Evaluation is separate from execution.** A repeatable evaluator consumes approved, redacted traces and fixed test cases. It does not gain production credentials, hidden holdout contents, or permission to replay external side effects.

## Privacy and security defaults

- Content capture is **off by default**. Do not export prompts, completions, message bodies, retrieved document text, tool arguments/results, attachments, audio transcripts, or user-entered content by default.
- Do not record credentials, access tokens, authorization headers, cookies, connection strings, secret values, or raw environment variables under any configuration.
- Use an explicit attribute allowlist. Reject or redact sensitive fields before span creation/export; do not rely only on backend-side masking.
- Prefer opaque, short-lived correlation identifiers. Do not use email addresses, phone numbers, names, raw user IDs, or document names as span attributes.
- Record bounded metadata such as operation name, provider/model identifier, tool name, status, error class, duration, retry count, policy outcome category, deployment/environment, and source revision where safe.
- Any future content-capture mode requires a separate explicit approval, access controls, retention policy, documented purpose, and tests proving redaction. It must not be enabled by an exporter endpoint alone.
- Export failure must not bypass Gen-X checks or change task authorization. Define bounded buffering, timeout, and drop behavior so telemetry outages do not block or destabilize critical execution paths.
- Apply sampling and cardinality limits. Never attach unbounded user-controlled values to metric labels or span attributes.

## Trace contract

Each agent execution trace should support, where applicable:

- Root operation: opaque task correlation ID, service/version, environment, source revision, start/end time, outcome.
- Model span: provider, model/revision, request class, response status, token/cost measurements only when supplied by a trusted provider adapter.
- Tool span: registered tool identifier, schema/version, duration, outcome, retry classification; no raw arguments or results by default.
- Retrieval span: retrieval strategy, index/model version, result count and latency; no retrieved content or sensitive document identifiers.
- Authorization event: policy decision category, capability identifier, approval-present boolean, and outcome; no secret policy material or approval token.
- Sandbox span: isolated job identifier, runtime, resource-limit outcome, exit category and duration; no environment secrets or unrestricted stdout/stderr.
- Error details: normalized error class and safe diagnostic code, with bounded sanitized messages.

Trace IDs are for observability and correlation only. Durable audit records for consequential actions remain in the authoritative audit store and must not depend on an external telemetry collector.

## MLflow / Databricks integration

- Implement an optional OTLP export configuration compatible with the Databricks MLflow native OpenTelemetry ingestion endpoint and its table-scoped authentication requirements.
- Keep destination credentials in the hosting platform's secret store. Never commit, log, expose in frontend configuration, or put tokens in trace attributes.
- Validate endpoint TLS, authentication failure handling, bounded retry/backoff, shutdown flush, and destination outage behavior.
- Document that Unity Catalog governs access to stored trace data; RyanAI must still minimize what it exports.
- Do not add Anthropic SDK instrumentation solely because the reference article uses Claude. RyanAI's provider-neutral spans should cover its existing model adapters consistently.
- Do not make Databricks account creation, workspace changes, paid features, or production credential setup part of this repository PR.

## Evaluation workflow

1. Select an approved, versioned development case set with expected outcomes and deterministic assertions where possible.
2. Capture the baseline trace set with code revision, prompt/skill version, model configuration identifier, evaluator version, and environment metadata.
3. Use human review for domain-specific quality judgments; preserve reviewer rationale without exposing private data to the agent under evaluation.
4. Evaluate the revised implementation against the same cases and same scorer versions.
5. Compare task success, policy compliance, tool correctness, redundant calls, retry behavior, latency, and measured cost.
6. Keep hidden holdout cases and expected answers outside the evaluated agent's read/write access. Return only aggregate scores and sanitized failure categories.
7. Replay must be read-only: never reissue email, WhatsApp, SMS, voice, financial, deployment, database-write, or other external side effects.
8. Require human review of scorer changes and benchmark revisions. Do not let the agent modify its own evaluator, thresholds, or holdout data.

MLflow can be an optional trace review/evaluation interface. The existing RyanAI benchmark harness and independent holdout rules remain authoritative for model comparisons and promotion decisions.

## Phased implementation and acceptance gates

### Phase 0 — inventory (first code PR)
- Map all telemetry modules, imports, process entrypoints, package versions, and existing tests.
- Identify whether more than one SDK can start in a process.
- Map active agent/model/tool/retrieval/sandbox call sites and async propagation boundaries.
- Record exact baseline build/typecheck/test results.

### Phase 1 — canonical lifecycle
- Consolidate to one SDK bootstrap per process without changing authorization or application behavior.
- Make exporter selection explicit and safe; avoid silently exporting to an unintended localhost endpoint in hosted environments.
- Implement idempotent startup and bounded graceful flush/shutdown.
- Add tests for disabled mode, OTLP mode, duplicate initialization, shutdown, exporter errors, and absence of sensitive attributes.

### Phase 2 — application spans
- Add provider-neutral model, tool, retrieval, sandbox, and agent spans.
- Add trace-context propagation where supported.
- Add redaction/allowlist tests using seeded secret and personal-data fixtures.
- Verify tracing cannot change tool authorization, approval, retries, or side-effect behavior.

### Phase 3 — optional MLflow destination and evaluation
- Document optional OTLP destination configuration without adding live credentials.
- Add offline fixture-based trace export/contract tests.
- Add repeatable baseline-vs-candidate evaluation with immutable case/scorer versions and protected holdouts.
- Validate collector outage, sampling, retention, access-control, and replay safety.

### Acceptance criteria

- Exactly one SDK lifecycle per process and no duplicate signal handlers.
- No content capture or secrets in default traces.
- Trace propagation and parent-child structure verified across representative agent/model/tool paths.
- Gen-X decisions remain enforced independently of telemetry availability.
- Telemetry exporter failure does not cause an unauthorized action, duplicate side effect, or unsafe fail-open path.
- Same-case evaluation is reproducible and holdout data remains inaccessible to the agent.
- Tests, security scans, and CI report results for the exact PR head SHA; queued, skipped, missing, or provider-blocked checks are not passing.
- Human review is required before merge. No production deployment, secret setup, paid upgrade, or production database change is included.

## Explicit non-goals

- Replacing PostgreSQL/pgvector memory or the authoritative audit store.
- Giving agents permission to inspect traces containing unrestricted user content.
- Automatically sending messages, executing tools, changing policy, merging PRs, or deploying based on trace analysis.
- Making Databricks or MLflow mandatory.
- Enabling prompt/tool-content capture by default.
- Changing production infrastructure or credentials in this work.

## Reference

- Databricks Engineering, “Claude Platform now supports native OpenTelemetry observability in Databricks MLflow,” 2026-11-03 (user-provided article).
- OpenTelemetry: https://opentelemetry.io/docs/
- MLflow tracing documentation: https://mlflow.org/docs/latest/genai/tracing/
