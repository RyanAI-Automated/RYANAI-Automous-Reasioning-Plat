# RIIP model registry

The registry lives in `governance/model-governance.yaml`. It is intentionally conservative: current reasoning provider slots are marked configured-but-unverified; the merged Ollama adapter is marked runtime-unverified; specialist candidates remain evaluation-only or deferred.

## Registration rules

Every entry must have a stable ID, provider, role, task-family allowlist, explicit status, authority set to `none`, activation boundary, and mandatory evaluation. Never store credentials, private endpoints containing tokens, or user data in this registry.

## Status transitions

`evaluation_only` → `verified` is not an automatic code transition. A promotion proposal must attach the exact checkpoint/revision, licence review, held-out benchmark, security results, ZAR cost analysis, fallback test, rollback evidence, and human approval. A runtime health check alone cannot move a model to `verified`.

## Provider-neutral adapter expectations

An adapter should normalize provider/model identity, capability declarations, input/output schemas, limits, timeout/cancellation, usage metadata, refusal/error/unavailable states, correlation ID, and provenance. It must not expose policy-authority methods or privileged tools.

## Compatibility and replacement

Keep the orchestrator and PostgreSQL/pgvector persistence independent of provider implementation. A candidate embedding model uses a separate collection/index and cannot overwrite the current index before explicit approval and tested rollback. Local-only inference must not silently fall back to a cloud endpoint.

## Scope of this baseline

This registry and its validator establish policy and onboarding discipline. They do not yet add runtime model routing, provider credentials, model downloads, a model-serving deployment, or automatic promotion.
