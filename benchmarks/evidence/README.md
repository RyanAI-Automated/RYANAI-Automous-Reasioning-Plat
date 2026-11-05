# Six-gate evidence bundles

This directory defines the evidence-recording contract only. It does not contain model outputs, provider credentials, production data, or a benchmark runner.

## Current implementation boundary

- No model invocation or model download is authorised.
- Every gate must have its own record and verdict: `PASS`, `FAIL`, or `BLOCKED`.
- Missing evidence is never interpreted as `PASS`.
- A `PASS` requires at least one SHA-256-addressed artifact, a named owner, a versioned procedure, independent attestation, and an attestation timestamp.
- Profile A (`A_OFFLINE_OLLAMA`) and Profile B (`B_REMOTE_PROVIDER`) have separate Gate 1 verdicts. One profile cannot inherit the other's isolation result.
- Profile B is blocked unless a numeric ZAR ceiling and explicit evaluation-scope approval are present before any provider request.
- Secret values must never be included. Profile B records only the approved secret *name*.

## Validate

Run:

```sh
node scripts/validate-benchmark-gate-evidence.mjs path/to/evidence-bundle.json
node --test scripts/validate-benchmark-gate-evidence.node-test.mjs
```

The validator checks evidence structure and fail-closed prerequisites. It does not itself prove network isolation, dataset custody, model provenance, scorer correctness, measured performance, ZAR billing, or Gen-X enforcement. Those require separate executable procedures and independently retained evidence. A structurally valid bundle with `BLOCKED` gates remains blocked.

Do not commit actual provider outputs, secrets, held-out data, private datasets, or production telemetry to this repository.
