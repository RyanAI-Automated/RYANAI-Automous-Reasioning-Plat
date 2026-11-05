# Benchmark gate executable checks

**Phase:** mock-only implementation; model invocation remains disabled.

## Implemented checks

| Gate | Executable check | Current result boundary |
|---|---|---|
| 1. Isolation | Disposable Docker network namespace; loopback fixture, direct public/private/DNS probes, only-loopback interface check and machine-readable per-probe evidence | Harness evidence only; actual runner and Ollama deployment remain BLOCKED |
| 2. Dataset | Development file SHA-256, task count, unique IDs, safe path checks, evaluator-key leakage checks, externally pinned trust roots, distinct Ed25519 custody/access-audit/contamination attestations | Signed claims are verified; external ACL runtime enforcement still needs independent probing |
| 3. Provenance | Harness commit, runtime lock, dataset/prompt/config hashes, immutable candidate identity and signed auditor attestation checked against an externally pinned Ed25519 trust root | Signed local provenance is verified; provider-side revision claims still require provider attestation and independent review |
| 4. Scoring | Unique deterministic assertion IDs, one pinned evaluator version, expected/observed SHA-256 consistency, scoring-oracle exclusion, safety override and structured blinded-review metadata | Synthetic contract tests only; signed reviewer identity, actual blinded review and calibration remain BLOCKED |
| 5. Economics | Failure-inclusive accounting, meter calibration/raw hashes, sampling windows, idle baseline, tariff/amortization evidence, ZAR calculation and three-run repeatability | Supplied evidence metadata and arithmetic only; instrument authenticity and actual measurements remain BLOCKED |
| 6. Gen-X | Real Gen-X policy, signed request-bound Ed25519 approval receipts, independent approver identity, expiry/replay checks, service-outage denial and fsync-backed append-only audit journal/tamper checks | Synthetic approval-service and single-process file-journal contract only; production service authentication and transactional database audit persistence remain BLOCKED |

## Commands

Run deterministic tests:

    npm run test:benchmark:contracts

Run the isolated container boundary probe:

    bash scripts/benchmark-isolation-container.sh

Verify a development dataset:

    node scripts/verify-benchmark-dataset.mjs <manifest> <dataset-root> <evidence-root> <external-trust-roots.json> <trust-roots-sha256>

Verify provenance:

    node scripts/verify-benchmark-provenance.mjs <run-manifest> <artifact-root> <external-trust-roots.json> <trust-roots-sha256>

The isolation container uses network mode none, a read-only root filesystem,
only two allowlisted read-only files, dropped Linux capabilities,
no-new-privileges, a non-root UID, and bounded CPU, memory, process count and
temporary storage. The probe starts only local HTTP fixtures. It does not start
Ollama or invoke a model.

## Explicit limitations

- The isolation probe does not certify the developer workstation, production
  runner, or future Ollama deployment.
- Signed dataset custody attestations validate signer identity, role separation,
  evidence scope, signature integrity and expiry. They do not prove that the
  external held-out store enforces ACL controls at runtime. An independent ACL
  probe and externally retained trust-root pin remain required.
- Signed provenance authenticates the local run record and verified artifact
  identities. It does not prove a provider's immutable model revision; provider
  attestation and independent review remain required.
- Deterministic scoring requires unique assertion IDs, a pinned evaluator version
  and matching expected/observed hashes. Structured review metadata does not
  authenticate the reviewer; signed reviewer identity, blinded review and
  calibration remain independently required.
- ZAR calculations require meter start/end readings, idle baseline, calibration
  and raw-meter evidence hashes, effective tariff evidence, hardware amortization
  evidence and failure-inclusive task denominators. Validated metadata does not
  prove instrument authenticity; independent telemetry review remains required.
- The Gen-X approval receipt contract tests request binding, signer identity,
  expiry, replay denial, service outage and audit-journal persistence. Its file
  journal is a single-process test adapter, not a production database. Live
  approval-service authentication, transactional database audit persistence,
  cross-process nonce uniqueness and independently retained audit evidence remain
  BLOCKED.

Every verifier leaves its corresponding gate BLOCKED pending independent
evidence review. Profile A and Profile B isolation verdicts remain separate.
No provider workflow, model download, model invocation, production routing,
deployment, or secret change is part of this phase.
