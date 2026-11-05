# Benchmark gate executable checks

**Phase:** mock-only implementation; model invocation remains disabled.

## Implemented checks

| Gate | Executable check | Current result boundary |
|---|---|---|
| 1. Isolation | Disposable Docker network namespace; loopback fixture and blocked public/private/DNS probes | Harness evidence only; actual runner deployment remains BLOCKED |
| 2. Dataset | Development file SHA-256, task count, unique IDs, path/symlink checks, evaluator-key leakage checks, held-out evidence hashes | Structure and hashes only; external ACL needs independent review |
| 3. Provenance | Harness commit, lockfile, prompt/config hashes, candidate revision pin and secret scan | Local hashes only; provider revision claims need confirmation |
| 4. Scoring | Deterministic assertion completeness, safety override, scoring-oracle exclusion, blinded-review fields | Synthetic contract tests only; real reviewer calibration remains BLOCKED |
| 5. Economics | Failure-inclusive task accounting, latency percentiles, repeatability inputs and measured ZAR formula | Synthetic arithmetic only; actual telemetry and tariff evidence remain BLOCKED |
| 6. Gen-X | Tests call the current deterministic Gen-X policy for forged claims, injection, escalation and identity failures | Policy-function tests only; approval-service outage and durable audit integration remain BLOCKED |

## Commands

Run deterministic tests:

    npm run test:benchmark:contracts

Run the isolated container boundary probe:

    bash scripts/benchmark-isolation-container.sh

Verify a development dataset:

    node scripts/verify-benchmark-dataset.mjs <manifest> <dataset-root> <evidence-root>

Verify provenance:

    node scripts/verify-benchmark-provenance.mjs <run-manifest> <artifact-root>

The isolation container uses network mode none, a read-only root filesystem,
a read-only repository mount, dropped Linux capabilities, no-new-privileges,
a non-root UID, and bounded CPU, memory, process count and temporary storage.
The probe starts only a local HTTP fixture. It does not start Ollama or invoke a
model.

## Explicit limitations

- A container probe does not certify the developer workstation, production
  runner, or future Ollama deployment.
- Hashing ACL, access-log and contamination-review artifacts does not prove
  that the external held-out store enforces those controls.
- A revision string and local hash do not prove a provider's immutable model
  snapshot; provider-side confirmation is still required.
- Synthetic scoring fixtures do not replace blinded human review or reviewer
  calibration.
- ZAR calculations require measured energy, declared tariff and disclosed
  amortisation assumptions. No estimate is reported as measured.
- The current Gen-X policy is a synchronous application policy function.
  The tests do not prove durable audit storage or an external approval service
  is available and fail-closed during an outage.

Every verifier returns a structure-level result and leaves its gate BLOCKED.
Only independent evidence review can change a gate verdict. Profile A and
Profile B isolation verdicts remain separate. No provider workflow, model
download, model invocation, production routing, deployment, or secret change
is part of this phase.
