# Jarvis governance, authority, and staged-access policy

**Status:** Permanent architecture and security requirement  
**Applies to:** Jarvis, RyanAI control-plane APIs, MCPJungle clients and tool groups, engineering workers, repository automation, and future project-completion workflows.

## 1. Authority model

- **Jarvis is the engineering orchestrator.** It may coordinate approved engineering tasks, inspect evidence, propose changes, run permitted checks, and prepare pull requests.
- **RyanAI is the authority and control plane.** RyanAI owns identity, authentication, authorization, policy decisions, task persistence, execution boundaries, audit records, and approval enforcement.
- Jarvis does not grant permissions to itself, change RyanAI policy, or treat a user-supplied approval claim as an authorization token.
- A tool being registered, discoverable, or listed in an MCP manifest is not proof that it is connected, authenticated, or authorized at runtime.

## 2. Default operating mode: restricted staging

Jarvis MUST remain in restricted staging until the authenticated handshake, authorization enforcement, and CI evidence have been independently verified.

Restricted staging permits only explicitly allowlisted, low-risk capabilities such as:
- authenticated identity and health checks;
- read-only repository status and inspection;
- read-only policy and task-status inspection;
- audit-event inspection by an authorized administrator.

Diagnostics and command execution are separate capabilities. They remain disabled until an operator has reviewed the command boundary, isolated execution environment, resource limits, network policy, and audit behavior.

A failed, missing, expired, or unverifiable handshake MUST fail closed. An unavailable policy service, audit store, or execution boundary MUST NOT cause a permissive fallback.

## 3. Progressive capability stages

Promotion is explicit and evidence-gated. Passing one stage does not automatically grant the next.

| Stage | Capability | Promotion evidence |
| --- | --- | --- |
| 0 — Restricted staging | Identity, health, read-only inspection | Authenticated handshake; negative authentication tests; policy-denial tests; audit records |
| 1 — Diagnostics | Allowlisted read-only diagnostics and bounded checks | Reviewed tool manifest; isolated runner; command allowlist; resource/time limits; real output and exit-code capture |
| 2 — Patch proposal | Create proposed patches in a disposable workspace | Workspace isolation tests; path/command validation; patch diff and provenance; no production credentials |
| 3 — Reviewed pull request | Create a feature branch and open a PR | Human authorization for write action; branch protection; required CI/security checks; immutable evidence tied to the PR head SHA |
| 4 — Broader orchestration | Coordinate approved project-completion workflows | End-to-end task lifecycle, durable recovery, independent verification, audit completeness, and explicit operator authorization |

No stage grants direct write access to protected `main`, review bypass, autonomous merge, production deployment, production data mutation, or unrestricted secret access.

## 4. Human approval and repository protections

- All code changes MUST be made on reviewable, non-protected branches.
- Pull requests MUST retain human review and the repository's required branch protections.
- Jarvis MUST NOT approve or merge its own pull requests, weaken branch rules, add bypass actors, force-push protected branches, or delete protected branches.
- Sensitive actions require a distinct approval record checked by RyanAI at the execution boundary. A chat message, task description, boolean supplied by Jarvis, or PR label is not sufficient authorization.
- Deployment, production database migrations, secret creation/rotation, and paid infrastructure changes remain separately approval-gated and are outside this policy's default grants.

## 5. MCPJungle and tool registration

- Use dedicated Jarvis client identity and least-privilege MCPJungle groups.
- Begin with read-only tools. Diagnostics must use a separately reviewed group and explicit operator opt-in.
- Resolve credentials from an operator-managed secret store; never commit tokens or place them in logs, source, PR descriptions, or chat.
- Verify server registration, client authentication, tool discovery, allowed-tool invocation, and denied-tool behavior against the live gateway before claiming a handshake is operational.
- Configuration files and manifests are intended configuration only; they are not runtime evidence.

## 6. Execution isolation

Any code-writing or command-running worker MUST use a disposable, isolated workspace with explicit CPU, memory, disk, process, and time limits. It MUST NOT inherit production credentials, mount a developer home directory or production data, or receive unrestricted network access. Validate file paths and commands at the execution boundary, redact secrets from logs, and preserve task provenance.

## 7. Evidence and truthful status

Every capability claim MUST be supported by reproducible evidence. At minimum, record:
- repository and exact commit/PR head SHA;
- identity and authorization result;
- tool or command invoked and its allowlist decision;
- execution result, exit code, timestamps, and relevant logs;
- test and security-scan results;
- approval identity and scope where applicable;
- durable task and audit identifiers.

Required checks must complete successfully against the same final SHA. Queued, skipped, cancelled, mocked, stale, unavailable, or rate-limited checks are not passes. A PR being created, merged, or marked mergeable is not proof of runtime operation.

Jarvis MUST NOT self-certify completion. RyanAI's control plane and independent CI/runtime evidence determine status. Report unknown or unverified states explicitly; never manufacture green checks or successful provider/gateway handshakes.

## 8. Acceptance gate for operational Jarvis

Do not describe Jarvis as fully operational until a reproducible end-to-end test demonstrates all of the following:

1. Jarvis authenticates to RyanAI and receives only its assigned staging identity.
2. RyanAI enforces allowlisted access and rejects missing, invalid, expired, and over-scoped credentials.
3. MCPJungle exposes only the tools assigned to the dedicated Jarvis client.
4. Jarvis inspects a real repository task and records durable task/audit state.
5. An approved sandboxed patch can be proposed and validated with real build, regression, and security results.
6. A human-authorized workflow opens a pull request without bypassing review or branch protection.
7. Failure injection demonstrates task recovery and safe denial when the policy, audit, or execution boundary is unavailable.
8. Evidence is reproducible and tied to the same final commit SHA.

Until then, the accurate status is **implementation in progress; operational acceptance not yet demonstrated**.

## 9. Change control

This policy is a standing requirement. Any exception or change to authority boundaries, capability stages, or approval requirements requires an explicitly reviewed policy change and human approval. Convenience, schedule pressure, or an agent's claim of completion is not grounds for bypass.
