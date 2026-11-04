# GenAIcode engineering adapter

RyanAI can delegate an explicitly approved engineering task to a separately installed
[GenAIcode](https://github.com/gtanczyk/genaicode) CLI. This is an optional coding-agent
adapter, not a new reasoning brain and not a replacement for Jarvis, the durable PostgreSQL
queue, or RyanAI's verification and review gates.

## Compatibility

- RyanAI's root runtime is Node.js 24.x; GenAIcode requires Node.js 20 or newer.
- The adapter uses the documented CLI contract: `genaicode run --json -a <agent> -C <workspace> -`.
- The upstream TypeScript agent API is experimental; RyanAI uses the CLI boundary.
- GenAIcode and the selected coding-agent CLI are installed/authenticated separately.
  No `npx`, automatic installation, new runtime dependency, billing change or lockfile change.

## Execution prerequisites

The adapter deliberately has **no direct host-process fallback**. A production caller must
supply both:

1. `authorizeTask(binding)`: a trusted RyanAI workbench service that reads the persisted
   job and approval records and confirms the exact task ID, approval evidence ID, plan
   SHA-256, 40-character Git commit SHA and proposed-diff SHA-256. It must reject self-approval and stale,
   rejected, cancelled or superseded approvals. A caller-supplied boolean is never accepted.
2. `sandboxRunner`: a separately configured runner with verified filesystem isolation,
   workspace-only mounts, CPU/memory/process/time limits, deny-by-default network policy,
   and an agent-only credential scope. The coding agent must not inherit the RyanAI API
   process environment or access the host user's home directory.

The runner must expose these capabilities:
`filesystemIsolation: true`, `workspaceMountOnly: true`, `resourceLimits: true`,
`networkPolicy: 'deny-by-default'`, and `credentialScope: 'agent-only'`.
These are required configuration assertions, not a substitute for validating the runner's
actual implementation and isolation tests.

## Security boundary

- RyanAI's authenticated control plane remains the sole authority for identity and approval.
- Approval is revalidated against exact persisted plan, base commit and diff bindings before
  every launch; approver and author must be distinct.
- Direct host execution is disabled. Missing authorizer or sandbox runner fails closed.
- The prompt is sent through stdin, never process arguments.
- The adapter forwards only a small non-secret environment allowlist. HOME and user-profile
  paths are intentionally omitted; the sandbox supplies an ephemeral isolated home.
- No auto-approval/unrestricted flags, commits, pushes, merges, deployments, secret access,
  database migrations or production mounts.
- Prompt size, execution time, event count and stdout size are bounded; stderr and unknown
  output are discarded.
- Process completion is **not** verification. Results carry `verification: 'not-run'`.
  RyanAI must run approved tests and security checks, ingest trusted CI evidence tied to the
  final PR head SHA, and obtain independent evaluation/assurance before acceptance.
- Persist task intent, approval identity, workspace identity, process outcome and verification
  evidence in RyanAI's existing durable evidence ledger. Do not store provider credentials or
  raw agent transcripts.

## Tests

Run `npm run test:genaicode`. Tests use a fake authorizer and isolated-runner contract;
they do not require provider credentials, external CLI login, network access or paid services.
