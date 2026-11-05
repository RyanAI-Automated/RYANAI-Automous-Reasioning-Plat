# Six-gate evidence bundles

This directory defines the evidence-recording contract only. It contains no
model outputs, provider credentials, production data, or benchmark runner.

## Current implementation boundary

- No model invocation or model download is authorised.
- Every gate has its own verdict: PASS, FAIL, or BLOCKED.
- Missing evidence is never interpreted as PASS.
- A PASS requires a hashed artifact, named owner, versioned procedure,
  independent attestation, and attestation timestamp.
- Profile A (A_OFFLINE_OLLAMA) and Profile B (B_REMOTE_PROVIDER) have
  separate Gate 1 verdicts. One profile cannot inherit the other's result.
- Profile B requires a positive ZAR spend ceiling and explicit evaluation
  approval before any provider request.
- Secret values must never be included. Profile B records only the approved
  secret name.

## Validation

Run:

    node --test scripts/validate-benchmark-gate-evidence.node-test.mjs
    node --test scripts/benchmark-evidence-contracts.node-test.mjs
    node --test scripts/benchmark-genx-policy-contract.node-test.mjs

The executable checks validate development dataset hashes, externally pinned
Ed25519 custody attestations, provenance pins, deterministic scoring contracts,
repeatability inputs, ZAR arithmetic, and the current Gen-X policy function.
Signed custody assertions still require an independent runtime ACL probe. The
checks do not prove provider-side revision claims, actual model performance,
durable audit persistence, or production runner isolation.

A structurally valid evidence bundle with BLOCKED gates remains blocked.
Do not commit provider outputs, secrets, held-out data, private datasets, or
production telemetry to this repository.
