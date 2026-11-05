# Six-gate evidence bundles

This directory defines the evidence-recording contract only. It contains no
model outputs, provider credentials, production data, held-out dataset contents,
or benchmark runner.

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

    npm run test:benchmark:contracts

The mock-only contracts validate development dataset hashes, signed custody
attestations, signed local provenance, deterministic scorer structure,
measurement-evidence metadata, three-run repeatability, and the Gen-X approval
and audit contract.

The Gen-X approval test uses a signed synthetic approval service and a
single-process fsync-backed file journal. It does not prove production Supabase
transport authentication, a real external approval service, a transactional
PostgreSQL audit append, cross-process nonce uniqueness, or independent audit
retention. The live service boundary remains BLOCKED until those controls are
independently verified.

A structurally valid evidence bundle with BLOCKED gates remains blocked.
Do not commit provider outputs, secrets, held-out data, private datasets, or
production telemetry to this repository.
