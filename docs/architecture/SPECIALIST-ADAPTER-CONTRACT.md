# Specialist adapter execution contract

**Status:** Shared execution boundary; no specialist provider is activated by this contract.

The RIIP YAML registry remains the source of truth for each specialist's status and activation boundary. This module supplies a shared typed interface for adapters and a fail-closed registry that consumes the current policy record at invocation time.

## Contract

Every adapter must declare a stable registry ID, an exact model/checkpoint revision, an input validator, and a typed invocation implementation. The registry validates the input and exact revision, reads the authoritative policy record, and then asks an injected independent authorization service (Gen-X) for a decision before calling the adapter.

The Gen-X decision must be affirmative and contain a policy version and an audit/approval reference. An absent policy, missing adapter, stale revision, malformed input, incomplete authorization decision, or cancelled request fails closed. There is no implicit provider fallback.

## Activation rules

- `evaluation_only` models may be considered only in `offline_benchmark` mode.
- `disabled` and `deferred_legal_review` models cannot be invoked.
- `production` mode requires both `status: verified` and `activation: production` in the current governance record, followed by a positive Gen-X decision.
- The registry never changes the governance status and never treats a model output as authorization.

Hydrogen-1.0 still needs all six independent benchmark gates and separate explicit user approval of the exact evaluation scope before any model call or weight download. The adapter contract is not approval to invoke it. Nemotron-Orchestrator-8B remains disabled/research-only; Arch-Router remains legally deferred.

## Deliberate non-goals

This contract does not add provider SDKs, download weights, make network requests, install model runtimes, provide credentials, run models, switch production routing, or prove model quality/runtime health. Model-specific adapters must be implemented in isolated, reviewable changes with licence, security, held-out quality, resource, language, ZAR cost, fallback, and rollback evidence.
