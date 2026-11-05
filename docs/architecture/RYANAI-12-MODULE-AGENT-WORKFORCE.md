# RyanAI 12-Module Agent Workforce

**Status:** Proposed implementation baseline; registry code is added by this change.  
**Authority:** RyanAI owns authorization and execution policy. Gen-X enforces policy. Jarvis coordinates work but cannot grant itself or another agent permissions.

## Objective

Give each of RyanAI's twelve operational modules one accountable primary specialist agent. Agents should have a continuous supply of useful, bounded work through event-driven queues and scheduled diagnostics, without requiring twelve permanently running model processes.

This is a workforce ownership model, not a claim that twelve agents are currently running. The registry defines identities, responsibilities, task types, safe capabilities, and KPIs. Runtime dispatch, worker availability, schedules, persistence, and live telemetry must be verified separately before describing the workforce as active.

## Twelve primary assignments

| Module | Primary agent | Permanent duties |
|---|---|---|
| Admin Console | Admin Steward | Configuration audits, administrative workflow diagnostics, access-boundary review; report permission changes rather than applying them. |
| Operator Console | Operations Operator | Task triage, dependency tracking, handoff quality, blocker reporting. |
| Command Cockpit | Cockpit Observer | Freshness-aware health and telemetry review; correlate verified signals and flag stale/missing data. |
| Quant Lab | Quant Researcher | Market-data provenance, strategy research, isolated simulation, paper-trading risk review; no brokerage or live orders. |
| Audiobook Studio | Audiobook Producer | Project/job diagnostics, transcription and rendering quality, asset provenance. |
| Communications | Communications Steward | Channel readiness, identity, consent, attachments, templates and delivery evidence; drafts only, no external dispatch. |
| GitHub Engineering | Repository Engineer | Official-repository maintenance, CI diagnostics, isolated patches, review-ready PRs with exact-head evidence. |
| Inference Console | Inference Analyst | Independent provider/model evaluation, benchmark quality, latency, availability and cost reporting. |
| Memory Vault | Memory Curator | Authorised retrieval quality, provenance, freshness, contradiction and retention review; PostgreSQL + pgvector stay authoritative. |
| Voice | Voice Quality Analyst | Speech recognition/synthesis, latency, device readiness, accessibility and consent-aware tests. |
| RyanAI Studio | Studio Builder | Workspace/editor workflow reliability, project scaffolding and regression review. |
| Operations Center | Reliability Coordinator | Cross-module incidents, queues, retries, service readiness and recovery evidence. |

The assignment maps to current application route/module identifiers where present. GitHub and Voice are represented as operational capabilities even though they are not standalone entries in `app/routes.json`.

## Command and accountability model

1. **RyanAI** — final authority for permissions, execution scope and policy.
2. **Gen-X** — policy and authorization gate. It may deny or escalate; it cannot silently waive human approval.
3. **Jarvis** — chief orchestrator: decomposes work, assigns module owners, coordinates cross-module specialists, tracks dependencies and compiles evidence.
4. **12 module agents** — accountable primary owners for their module's diagnostics, backlog and improvement proposals.
5. **Shared specialist workers** — existing repository, CI, security, database/queue, provider, communications, frontend and release workers remain reusable across module teams.

A module agent may request help from a shared specialist, but cannot expand that specialist's permissions. Cross-module work has one named accountable owner and explicit contributing agents.

## Continuous work policy

Use event-driven scheduling and bounded worker concurrency rather than keeping a model session alive 24/7.

Suggested cadence defaults (configuration targets, not active schedules):

- Every 5 minutes: inspect due queue work and urgent event notifications.
- Every 15 minutes: refresh module health when the relevant source is available.
- Hourly: reconcile backlog, dependencies and task priorities.
- Every 6 hours: run deeper module diagnostics within resource budgets.
- Daily: produce per-agent activity, outcome, failure and blocker reports.
- Weekly: review recurring incidents, KPI trends, safety boundaries and workload balance.

Do not poll a provider or database more frequently than its rate limits and operational budget allow. Apply per-agent concurrency limits, bounded retries with backoff, task leases, idempotency keys, cancellation and dead-letter handling. Prefer one worker process handling many small jobs over one permanent model process per module.

## Standard work cycle

1. **Observe:** read only authorised module state, telemetry and task events.
2. **Prioritise:** select a due task using severity, user impact, dependency, age and estimated resource cost.
3. **Plan:** record objective, acceptance criteria, execution scope, data classification, risks and rollback.
4. **Execute:** use only approved tools in isolated workspaces and within granted capabilities.
5. **Verify:** run relevant tests and checks; attach exact commit, run, log and artifact references.
6. **Report:** persist status, evidence, blockers, resource use and recommended next action.
7. **Continue:** claim the next eligible task or enter a low-cost waiting state.

## Task lifecycle and evidence

Use explicit states: `available`, `assigned`, `working`, `testing`, `awaiting_approval`, `blocked`, `completed`, `failed`, `cancelled`.

A task is completed only when its acceptance criteria and verification evidence are recorded. Queued, skipped, cancelled, configured, stale, or provider-blocked work is never reported as passed.

Each task record should include:

- task ID, module ID, owner agent ID and contributing agents;
- source event, objective, priority, created/due timestamps and dependency IDs;
- acceptance criteria, risk classification and execution scope;
- attempt count, lease/heartbeat, idempotency key and cancellation state;
- status, outcome summary, blocker and next action;
- exact commit SHA, workflow/run/job IDs, test results and evidence links where relevant;
- token/runtime/resource measurements and budget outcome.

The existing `agent_runs`, `agent_handoffs`, task-queue and evidence infrastructure should be evaluated and reused before adding tables. This change does not introduce a database migration.

## KPI framework

Measure verified outcomes, not message volume or raw task count:

- reliability: valid heartbeat, queue age, lease recovery, successful completion rate;
- quality: test pass rate, regression recurrence, evidence completeness;
- impact: severity-weighted defects found, risk reduced, user-impacting issues resolved;
- efficiency: tokens/runtime per verified outcome, retries and idle resource use;
- governance: policy denials respected, approval escalations correct, zero unauthorized side effects.

A high-quality escalation or correctly identified blocker is a useful outcome. Agents must not be incentivised to make unneeded changes.

## Non-negotiable safety boundaries

- No agent can grant permissions, change its own policy, bypass Gen-X, or authorize another agent.
- No production deployment, production migration, infrastructure mutation, secret creation/modification/rotation, paid upgrade, or automatic merge.
- GitHub changes use separate branches, exact-head CI/security evidence and human-reviewed PRs.
- No credentials or personal data in prompts, logs, traces, artifacts or PR descriptions.
- Communications agents may research and draft. Live WhatsApp, SMS, voice or email requires provider callback, owner-destination verification and explicit test authorization.
- Quant agents are research/simulation only. No brokerage credentials or live orders.
- Database writes and migrations remain subject to environment-specific approval and isolated testing.
- If evidence is unavailable, report `not_verified` or `blocked`, never success.

## Activation sequence

1. Merge the registry and this operating contract after CI/security checks and human review.
2. Integrate module ownership into task creation and Jarvis routing without broadening permissions.
3. Add queue-backed recurring diagnostic tasks with configurable cadence, concurrency and budgets.
4. Add a workforce dashboard showing agent identity, assigned task, heartbeat, state, evidence, blockers and resource use.
5. Enable module-by-module in a non-production environment; verify task lease recovery, idempotency, cancellation, policy denials and observability.
6. Request separate approval before any production rollout or schema/infrastructure changes.

## Acceptance criteria for this baseline

- Exactly twelve unique module agents and module IDs are defined.
- Every agent has a responsibility, task types, bounded actions and measurable KPIs.
- No module agent receives privileged or external side-effect capabilities.
- Unknown module, agent and task identifiers resolve to no owner rather than a guessed fallback.
- Existing shared specialist worker registry remains intact.
- No production configuration, secrets, deployment, database or infrastructure is changed.
