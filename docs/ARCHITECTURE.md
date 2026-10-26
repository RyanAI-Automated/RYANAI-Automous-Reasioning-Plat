# RyanAI architecture

This document names the one production path in this repository. It also lists the older code that you can remove later.

## Production path

`npm start` runs `src/server/launcher.ts`. This is the only supported entry point.

| Part | File |
|---|---|
| HTTP server, routes, authentication | `src/server/launcher.ts`, `src/server/routes/auth.ts` |
| Reasoning agent (LangGraph ReAct) | `src/agent/engine.ts` |
| Approval agent and supervisor | `src/agent/approvalEngine.ts`, `src/agent/supervisorGraph.ts`, `src/agent/subAgents.ts` |
| Agent tools | `src/agent/tools/` |
| Model configuration | `src/config/llm.ts` |
| Data | Postgres through Prisma (`prisma/schema.prisma`) |

## One model configuration

All agents call `createChatModel()` in `src/config/llm.ts`. Three variables control every agent:

- `OPENAI_MODEL` sets the model. The default comes from `models/catalog.json`.
- `OPENAI_BASE_URL` sets an OpenAI-compatible endpoint, for example a local vLLM server.
- `OPENAI_API_KEY` sets the key.

Do not write a model name in agent code.

## Agent tools

| Tool | Purpose | Access |
|---|---|---|
| `send_email`, `send_whatsapp_message`, `make_voice_call` | Communication | Any signed-in user |
| `remember_fact`, `recall_memory`, `forget_memory` | Long-term memory in the `memory_entries` table | Each user sees only their own entries |
| `list_workspace_files`, `read_workspace_file` | Read-only access to code | Administrators only. Set `AGENT_WORKSPACE_ROOT`. |

The routes pass the verified user in `configurable.userId` and `configurable.role`. The memory and workspace tools fail when these values are missing.

To make an administrator, set `app_metadata.role` to `admin` for that user in Supabase.

## Older code (not on the production path)

Nothing in the production path imports these files. Remove them after you confirm that no script or deployment uses them.

- `server.ts`, `src/server.ts`, `gateway.js`: older standalone gateways. They use `src/agent/reactGraph.ts` and `src/agent/reactWorkflow.ts`.
- `reactGraph.py`, `basic.py`, `ryanai_supervisor_prompt.txt`: a Python copy of the agent graph. The `.txt` file contains Python code.
- `src/engine/` and `src/config/brains.ts`: a second agent stack that uses Nemotron and Qwen models.
- `src/agent/nodes.ts`, `src/agent/react.ts`: not imported by any file.
- `COMPLETION_CERTIFICATE.txt`, `.completion-status.txt`: status claims that no test checks.

## Known gaps

- `verify_compliance` in `src/agent/subAgents.ts` always returns `COMPLIANT`. It does not check anything.
- The reasoning agent can send email, WhatsApp messages, and calls without approval. Only `humanInTheLoopAgent` asks for approval.
- The workspace tools cannot write files or run commands.
- There is no calendar tool, scheduler, or wake word.
