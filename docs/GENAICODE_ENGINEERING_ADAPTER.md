# GenAIcode engineering adapter

RyanAI can delegate an explicitly approved engineering task to a separately installed
[GenAIcode](https://github.com/gtanczyk/genaicode) CLI. This is an optional adapter, not a
new reasoning brain and not a replacement for Jarvis, the durable PostgreSQL queue, or
RyanAI's verification and review gates.

## Compatibility

- RyanAI's root runtime is Node.js 24.x; GenAIcode requires Node.js 20 or newer.
- The adapter uses GenAIcode's documented CLI contract: `genaicode run --json -a <agent> -C <workspace> -`.
- The GenAIcode CLI and the selected coding-agent CLI must be installed and authenticated
  separately. The adapter never invokes `npx`, installs packages, or changes billing.
- The upstream `genaicode/agents` API is marked experimental in GenAIcode 2.x. RyanAI
  therefore integrates through the documented CLI boundary instead of coupling production
  TypeScript types to an experimental package export.
- GenAIcode is Apache-2.0 licensed. The adapter does not vendor or modify upstream code.

## Enablement

Install GenAIcode and the coding-agent CLI using the operator's approved workstation or
engineering image process. Authenticate the coding agent using its own supported login
flow. Set `RYANAI_GENAI_CODE_BIN` only when the executable is not named `genaicode`.

The integration is disabled unless the calling engineering workflow supplies
`approved: true` and an explicit workspace root and workspace path. Example:

```js
import { runGenAICodeTask } from './src/engineering/genaicodeAdapter.mjs';

const result = await runGenAICodeTask({
  agent: 'codex',
  prompt: 'Review the failing unit test and propose a minimal repair.',
  workspaceRoot: '/srv/ryanai/engineering-workspaces',
  workspacePath: '/srv/ryanai/engineering-workspaces/task-123',
  approved: true, // must come from RyanAI's authorization decision, never model output
  timeoutMs: 20 * 60 * 1000,
});
```

Supported agent identifiers: `claude`, `codex`, `copilot`, `cursor`, `gemini`,
`opencode`, `muse`, `vibe`, and `antigravity`.

## Security boundary

- The executable is launched directly with `spawn` and `shell: false`; no shell interpolation,
  `npx`, or arbitrary command argument is used.
- The prompt is sent through stdin, not process arguments.
- The workspace path is resolved through the filesystem and must remain inside the
  explicitly approved workspace root; symlink escapes are rejected.
- Only a small OS/runtime environment allowlist is inherited. RyanAI provider credentials,
  deployment tokens, database URLs, Redis URLs, and other process environment values are not
  forwarded to the coding agent.
- No automatic-approval, unrestricted, or "yolo" flag is passed. The agent CLI's own
  sandbox and permission defaults remain in force.
- Prompt size, execution time, event count and stdout size are bounded. Raw stderr and
  unrecognised output are discarded rather than copied into RyanAI logs.
- The adapter does not commit, push, merge, deploy, access secrets, or apply database
  migrations.
- A successful process exit is **not** a verified code change. The result explicitly reports
  `verification: 'not-run'`; RyanAI must run its own fixed, policy-approved test and security
  checks on the isolated worktree before preparing a pull request.
- Persist task intent, authorization, workspace identity, process outcome and verification
  evidence in RyanAI's existing durable task/evidence systems before exposing a completion
  claim. Do not store provider credentials or raw agent transcripts in the evidence record.

## Tests

Run:

```bash
npm run test:genaicode
```

The tests use an injected fake process; they do not require a coding-agent login, network
access, external provider calls, or paid services.
