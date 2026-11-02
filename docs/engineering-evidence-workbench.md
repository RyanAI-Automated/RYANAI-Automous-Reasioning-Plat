# RyanAI Engineering Evidence Workbench

This workbench adds governed plan review and an append-only evidence trail to the existing PostgreSQL `agent_runs` queue. It does not fork Wicked Studio or install the Wicked Crew daemon.

## Safety model

- RyanAI's authenticated admin/control plane is the only API authority for creating engineering jobs and steering, approving, rejecting or cancelling them.
- A workbench job is created with `approval_status=pending`; the queue worker SQL explicitly excludes it.
- Approval requires a different authenticated admin from the job author and must match the exact `plan_hash`, `base_commit_sha` and `proposed_diff_hash` stored on the job.
- Steering stores the revised plan and diff, updates their hashes, and leaves the job pending. The previous approval is cleared.
- The worker claim query only selects approved jobs whose approved plan, commit and diff bindings still match the persisted values.
- Running cancellation sets a durable cancellation request. The worker lease heartbeat notices it, aborts provider work and persists a cancelled terminal state.
- Existing non-workbench queue jobs retain the legacy `approval_status=approved` default for compatibility. New engineering jobs must use the approval route.

## Evidence ledger

Every evidence event has a monotonically increasing per-job sequence, actor, event type, JSON payload, previous hash and SHA-256 hash. Writers lock the parent job row before selecting the previous event, so concurrent appends serialize. Database triggers reject direct update/delete; a parent job deletion may cascade for account/data erasure.

Events include plan submission/steering/approval/rejection, execution start/recovery/retry/completion/failure/cancellation, check receipts, independent evaluation and assurance receipts. Corrections are new events; old events are not edited.

The evidence bundle contains the job snapshot, handoffs, ordered evidence, chain-integrity result, latest check states, independent receipts, acceptance result and a bundle SHA-256 header.

## API

All endpoints are protected by `requireAdmin`:

- `GET /api/engineering/jobs` — recent job list.
- `POST /api/engineering/jobs` — submit objective, plan, base commit SHA and proposed diff; returns pending approval.
- `GET /api/engineering/jobs/:jobId` — job, handoffs, evidence integrity and acceptance state.
- `POST /api/engineering/jobs/:jobId/approve` — approve only matching plan/commit/diff digests; self-approval is rejected.
- `POST /api/engineering/jobs/:jobId/steer` — add human steering and submit the revised plan/diff; prior approval is invalidated.
- `POST /api/engineering/jobs/:jobId/reject` — reject a pending plan.
- `POST /api/engineering/jobs/:jobId/cancel` — cancel queued work or request cancellation of running work.
- `POST /api/engineering/jobs/:jobId/checks` — append check states (`pass`, `fail`, `skipped`, `pending`, `unverified`).
- `POST /api/engineering/jobs/:jobId/evaluations` — independent evaluation receipt.
- `POST /api/engineering/jobs/:jobId/assurance` — assurance receipt from a reviewer distinct from the author, approver and evaluator.
- `GET /api/engineering/jobs/:jobId/evidence-bundle` — downloadable JSON evidence bundle with integrity headers.

Check receipts submitted through the current API are explicitly labelled `human-reported`. There is no GitHub Actions check-run ingestion/webhook in this PR. A human-reported pass cannot make a job accepted. Acceptance requires a completed run, a valid evidence chain, every check to have a trusted `github-actions-verified` source, and passing independent evaluation and assurance receipts. Until trusted CI ingestion exists, acceptance remains `not_accepted`.

## Recovery

The existing durable queue lease/retry mechanism remains the recovery mechanism. A worker restart leaves the prior `execution.started` event intact; the next claim appends `execution.recovered` with the incremented attempt. Retry/failure/cancellation events are appended with the state transition.

## Explicit limitations and follow-up gates

1. The current worker is RyanAI's three-brain reasoning worker, not a general-purpose CLI coding/sandbox executor. This PR governs its durable queue and creates a plan/evidence API; it does not yet run Codex/Claude/Copilot CLI jobs in a sandbox.
2. The server hashes the submitted base commit and proposed diff and binds approval to those exact digests. It does not yet independently fetch the commit/diff from GitHub and prove the submitted diff is the repository's actual patch. Add trusted GitHub App/check-run integration before treating commit provenance or CI receipts as verified.
3. Evidence bundles are JSON, not yet signed or encrypted archives. The SHA-256 detects accidental changes only when the expected digest is held separately; it is not a signature or proof against an administrator with database write privileges.
4. No production migration, deployment, secret change, permission expansion or queue activation was performed by this PR.
5. Run Prisma generation, server typecheck, lint, unit tests, disposable PostgreSQL queue regression, migration validation, API auth tests and security scans before acceptance.

The acceptance principle is: an agent's own completion message is never sufficient. RyanAI must retain a verifiable record of intent, approval, execution, checks, independent review and authority.
