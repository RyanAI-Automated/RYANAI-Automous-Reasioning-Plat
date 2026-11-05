# Six-gate evidence bundles

This directory defines the evidence-recording contract only. It contains no
model outputs, provider credentials, production data, held-out dataset contents,
or benchmark runner.

## Current implementation boundary

- No model invocation or model download is authorised.
- Each gate has its own verdict: PASS, FAIL, or BLOCKED.
- Missing evidence is never interpreted as PASS.
- A PASS requires a hashed artifact, named owner, versioned procedure,
  independent attestation, and attestation timestamp.
- Profile A (A_OFFLINE_OLLAMA) and Profile B (B_REMOTE_PROVIDER) have separate
  Gate 1 verdicts. One profile cannot inherit the other's result.
- Profile B requires a positive ZAR spend ceiling and explicit evaluation
  approval before any provider request.
- Secret values must never be included. Profile B records only the approved
  secret name.

## Validation

Run all benchmark contracts:

    npm run test:benchmark:contracts

The test command runs mock-only dataset, provenance, scorer, economics,
isolation and Gen-X checks, plus route-level tests of the real Supabase-backed
administrator guard with mocked Supabase responses. No live identity-provider
request is made by the route contract.

The Gen-X approval contract uses synthetic signed approval-service receipts and
a single-process fsync-backed file journal. It checks request binding, signer
fingerprint, approver separation, expiry, replay, service outage, audit append
and journal tampering. This does not prove live approval-service authentication,
a transactional PostgreSQL audit append, cross-process nonce uniqueness, or
independent audit retention.

Signed held-out custody assertions still require an independent runtime ACL
probe. Signed provenance still needs provider-side revision attestation.
Scoring still needs authenticated blinded human review and calibration.
Resource measurement still needs actual independently reviewed meter, tariff
and hardware evidence. Isolation still needs evidence that the real execution
runner and Ollama endpoint meet the approved offline boundary.
The executable checks validate development dataset hashes, externally pinned
Ed25519 custody attestations, provenance pins, deterministic scoring contracts,
three-run repeatability, meter/tariff/amortization evidence, and ZAR arithmetic, and the current Gen-X policy function.
Ed25519 custody attestations, signed provenance pins, deterministic scoring contracts,
repeatability inputs, ZAR arithmetic, and the current Gen-X policy function.
Signed custody assertions still require an independent runtime ACL probe. The
checks do not prove provider-side revision claims, actual model performance,
production approval-service authentication, transactional audit persistence, or production runner isolation.

A structurally valid evidence bundle with BLOCKED gates remains blocked.
Do not commit provider outputs, secrets, held-out data, private datasets, or
production telemetry to this repository.
