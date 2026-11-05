# Benchmark gate executable checks

**Phase:** mock-only implementation; model invocation remains disabled.

## Implemented checks

| Gate | Executable check | Current result boundary |
|---|---|---|
| 1. Isolation | Disposable Docker network namespace; loopback fixture, public/private/DNS egress probes, only-loopback interface verification, and machine-readable per-probe evidence | Harness evidence only; actual runner/Ollama deployment remains BLOCKED |
| 2. Dataset | Development file SHA-256, task count, unique IDs, safe path checks, evaluator-key leakage checks, externally pinned Ed25519 trust roots and distinct custody/access-audit/contamination attestations | Signed claims are verified; external held-out ACL runtime enforcement still requires an independent probe |
| 3. Provenance | Harness commit, runtime lock, dataset/prompt/config hashes, immutable candidate identity, and signed auditor attestation against an externally pinned Ed25519 trust root | Signed local provenance is verified; provider-side revision claims still require provider attestation and independent review |
| 4. Scoring | Unique deterministic assertion IDs, one pinned evaluator version, expected/observed SHA-256 consistency, scoring-oracle exclusion, safety override, and structured blinded-review metadata | Synthetic contract tests only; authenticated reviewer identity, real blinded review, and calibration remain BLOCKED |
| 5. Economics | Failure-inclusive accounting, meter calibration/raw hashes, sampling windows, idle baseline, tariff/amortization evidence, ZAR calculation, and three-run repeatability | Supplied evidence metadata and arithmetic only; instrument authenticity and actual measurements remain BLOCKED |
| 6. Gen-X | Deterministic policy, signed request-bound Ed25519 approval receipts, separate approver identity, expiry/replay checks, service-outage denial, and fsync-backed append-only audit-journal/tamper contract | Synthetic approval service and single-process test journal only; production service authentication and transactional database audit persistence remain BLOCKED |

## Commands

Run all benchmark contract tests:

    npm run test:benchmark:contracts

Run the isolated container boundary probe:

    bash scripts/benchmark-isolation-container.sh

Verify a development dataset:

    node scripts/verify-benchmark-dataset.mjs <manifest> <dataset-root> <evidence-root> <external-trust-roots.json> <trust-roots-sha256>

Verify local provenance:

    node scripts/verify-benchmark-provenance.mjs <run-manifest> <artifact-root> <external-trust-roots.json> <trust-roots-sha256>

The isolation container uses network mode none, a read-only root filesystem,
only three allowlisted read-only files, dropped Linux capabilities,
no-new-privileges, a non-root UID, and bounded CPU, memory, process count and
temporary storage. The network fixture is not Ollama and does not invoke a model.

## Explicit limitations

- Isolation evidence describes a disposable test namespace only. It does not
  certify the developer workstation, hosted runner, or future Ollama deployment.
- Signed dataset custody attestations validate signer identity, role separation,
  evidence scope, signature integrity and expiry. They do not prove that the
  external held-out store enforces ACL controls at runtime. Independent ACL
  probing and externally retained trust-root pinning remain required.
- Signed provenance authenticates the local run record and artifact identities.
  It does not prove a provider's immutable model revision; provider attestation
  and independent review remain required.
- Deterministic scoring requires unique assertion IDs, one pinned evaluator
  version and matching expected/observed hashes. Structured reviewer metadata
  does not authenticate a person; signed reviewer identity, blinded review and
  calibration remain independently required.
- ZAR calculations require meter readings, idle baseline, calibration and
  raw-meter evidence hashes, effective tariff evidence, hardware amortization
  evidence, and failure-inclusive denominators. Validated metadata does not prove
  instrument authenticity; independent telemetry review remains required.
- The Gen-X approval contract uses synthetic signed service responses and a
  single-process fsync-backed file journal. A route-level Vitest contract checks
  the real Supabase-backed admin guard with mocked identity-provider responses;
  it does not call the live Supabase service. These tests do not prove live
  mTLS/Supabase transport authentication, transactional PostgreSQL audit
  persistence, cross-process nonce uniqueness, or independent audit retention.

Every verifier leaves its gate BLOCKED pending independent evidence review.
Profile A and Profile B isolation verdicts remain separate. No provider workflow,
model download, model invocation, comparison, production routing, deployment,
or secret change is part of this phase.
