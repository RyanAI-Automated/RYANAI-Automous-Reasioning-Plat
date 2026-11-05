# Benchmark gate executable checks

**Phase:** mock-only implementation; model invocation remains disabled.

## Implemented checks

| Gate | Executable check | Current result boundary |
|---|---|---|
| 1. Isolation | Disposable Docker network namespace; loopback fixture and blocked public/private/DNS probes | Harness evidence only; actual runner deployment remains BLOCKED |
| 2. Dataset | Development file SHA-256, task count, unique IDs, path/symlink checks, evaluator-key leakage checks, externally pinned trust roots, distinct Ed25519 signatures for custody, access audit and contamination review | Signed claims are verified; external ACL runtime enforcement still needs independent probing |
| 3. Provenance | Harness commit, lockfile, prompt/config hashes, candidate revision pin and secret scan | Local hashes only; provider revision claims need confirmation |
| 4. Scoring | Deterministic assertion completeness, safety override, scoring-oracle exclusion, blinded-review fields | Synthetic contract tests only; real reviewer calibration remains BLOCKED |
| 5. Economics | Failure-inclusive accounting, meter calibration/raw hashes, sampling windows, idle baseline, tariff/amortization evidence, ZAR calculation and three-run repeatability | Supplied evidence metadata and arithmetic only; instrument authenticity and actual measurements remain BLOCKED |
| 6. Gen-X | Tests call the current deterministic Gen-X policy for forged claims, injection, escalation and identity failures | Policy-function tests only; approval-service outage and durable audit integration remain BLOCKED |

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
a read-only repository mount, dropped Linux capabilities, no-new-privileges,
a non-root UID, and bounded CPU, memory, process count and temporary storage.
The probe starts only a local HTTP fixture. It does not start Ollama or invoke a
model.

## Explicit limitations

- A container probe does not certify the developer workstation, production
  runner, or future Ollama deployment.
- Signed ACL, access-log and contamination-review artifacts are verified against
  a separately supplied, SHA-256-pinned Ed25519 trust-root file. This validates
  signer identity, role separation, evidence scope, signature integrity and expiry;
  it still does not prove that the external held-out store enforces those controls
  at runtime. An independent ACL probe and externally retained trust-root pin remain required.
- A separately pinned Ed25519 auditor signature binds the exact local provenance
  manifest and verified artifact identities. It does not prove a provider's
  immutable model snapshot; provider-side attestation and independent review
  are still required.
- Deterministic scoring requires unique assertion IDs, a pinned evaluator version,
  and matching expected/observed hashes. Structured review metadata does not
  authenticate the reviewer; signed reviewer identity, blinded review and
  calibration remain independently required.
- ZAR calculations require meter start/end readings, idle baseline, calibration
  and raw-meter evidence hashes, effective tariff evidence, hardware amortization
  evidence, and failure-inclusive task denominators. Validated metadata does not
  prove instrument authenticity; independent telemetry review remains required.
- The current Gen-X policy is a synchronous application policy function.
  The tests do not prove durable audit storage or an external approval service
  is available and fail-closed during an outage.

Every verifier returns a structure-level result and leaves its gate BLOCKED.
Only independent evidence review can change a gate verdict. Profile A and
Profile B isolation verdicts remain separate. No provider workflow, model
download, model invocation, production routing, deployment, or secret change
is part of this phase.
