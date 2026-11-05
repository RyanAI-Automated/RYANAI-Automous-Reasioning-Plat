# RyanAI Cybersecurity Centre — data contract (phase 1)

## Scope

This migration establishes durable, attributable security scan, finding, evidence, remediation recommendation and human-approval records. It is a data-contract slice, not a claim that the dashboard, Kali runner or CI gates are already integrated.

## Reuse before adding tables

- `jarvis_audit_events` remains the general append-only audit-event stream for actors, decisions and administrative actions.
- `agent_run_evidence` remains the hash-linked evidence ledger for Jarvis engineering runs.
- `pending_actions` remains the existing mechanism for separately approved external actions.
- The new security tables hold domain-specific scan and finding state that does not fit those generic ledgers.

## Records

- `security_scans`: scanner/source, environment, target reference, branch, exact commit SHA, workflow run, toolchain, status and summary.
- `security_findings`: stable fingerprint, source rule, severity/confidence, affected component/location, CVE/CWE/CVSS and lifecycle status.
- `security_evidence`: artifact reference, SHA-256, media type and redacted excerpt/metadata. Evidence rows are immutable; corrections are new rows.
- `security_remediations`: recommendation, rationale, human review and a later verification scan. There is deliberately no automated-apply state or executor.
- `security_approvals`: short-lived, single-use approval bound to an exact target, environment and commit.

## Safety invariants

1. Scan environments are limited to `isolated_ci`, `isolated_kali_lab` and `staging`. Production is not a valid environment in this phase.
2. Every Kali scan must consume an approved, unexpired, unused approval with matching scope, environment, target and commit SHA. A database trigger enforces this on insertion.
3. Evidence is append-only and content hashes are validated when present. Raw credentials and unredacted secrets must never be stored as evidence.
4. Remediation rows are proposals/review outcomes only. No row or API in this phase executes a patch.
5. NVIDIA, Qwen, Logic and Ollama are not modified or replaced.
6. Jarvis receives no additional execution permissions from this schema.
7. No production migration/deployment is authorised by this change; apply only through the existing reviewed migration process.

## Next slices

- Authenticated, owner/admin-scoped API routes and Admin Console views.
- Read-only history and finding triage; explicit human review of remediation recommendations.
- An isolated Kali lab runner that cannot route to production or arbitrary internet targets.
- PR security workflow evidence bound to the pull-request head SHA, with required checks and human review enforced by repository settings.
