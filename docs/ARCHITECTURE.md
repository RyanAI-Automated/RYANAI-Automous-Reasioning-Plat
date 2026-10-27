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
| `schedule_task`, `list_scheduled_tasks`, `cancel_scheduled_task` | Tasks that run later, once or on a repeat | Each user sees only their own tasks |
| `list_workspace_files`, `read_workspace_file` | Read-only access to code | Administrators only. Set `AGENT_WORKSPACE_ROOT`. |
| `write_workspace_file` | Create or replace a file | Administrators only. Set `AGENT_WORKSPACE_ROOT` and `AGENT_WORKSPACE_WRITE=true`. |

The routes pass the verified user in `configurable.userId` and `configurable.role`. The memory, schedule, and workspace tools fail when these values are missing.

To make an administrator, set `app_metadata.role` to `admin` for that user in Supabase.

### Memory

Every request starts with the user's saved notes (up to 20) as a system message, so the agent knows the user without a tool call. `src/agent/invoke.ts` adds the message. The message is removed from the API response. The notes are marked as data, not instructions.

### Scheduled tasks

A user can ask for a task such as "check my notes every morning". The server saves it in `scheduled_tasks`. A runner in the server process checks every 60 seconds and runs the due tasks.

- **Off by default.** Set `SCHEDULER_ENABLED=true` to start the runner. Each run calls the model with no person present, so it costs money.
- **Limited tools.** A scheduled run can read and save notes only. It cannot send messages, write files, or schedule more tasks, because nobody can approve those actions.
- **Safe with many servers.** A server claims a task with one conditional update and a 10-minute lease. A task never runs on two servers at the same time. If a server stops in the middle of a run, the task runs again after the lease ends.
- **Limits.** 20 active tasks for each user. A repeat interval from 15 minutes to 7 days. A run stops after 120 seconds.
- **Results.** `GET /api/tasks` returns the tasks and their last result. `DELETE /api/tasks/:id` cancels a task.

### Workspace safety

The workspace tools work only inside `AGENT_WORKSPACE_ROOT`. They follow symbolic links before they check the path. They block `.git`, `node_modules`, env files, and key files. The write tool also blocks `.github`, because workflow files run with repository secrets. The write tool does not write through a symbolic link. An agent that reads untrusted files and can also write files is a risk, so keep `AGENT_WORKSPACE_WRITE` off unless you need it.

## Older code (not on the production path)

Nothing in the production path imports these files. Remove them after you confirm that no script or deployment uses them.

- `server.ts`, `src/server.ts`, `gateway.js`: older standalone gateways. They use `src/agent/reactGraph.ts` and `src/agent/reactWorkflow.ts`.
- `reactGraph.py`, `basic.py`, `ryanai_supervisor_prompt.txt`: a Python copy of the agent graph. The `.txt` file contains Python code.
- `src/engine/` and `src/config/brains.ts`: a second agent stack that uses Nemotron and Qwen models.
- `src/agent/nodes.ts`, `src/agent/react.ts`: not imported by any file.
- `COMPLETION_CERTIFICATE.txt`, `.completion-status.txt`: status claims that no test checks.

## Known gaps

- `verify_compliance` in `src/agent/subAgents.ts` always returns `NOT_VERIFIED`, because no compliance checks are connected.
- The reasoning agent can send email, WhatsApp messages, and calls without approval. Only `humanInTheLoopAgent` asks for approval.
- The agent cannot run commands. It cannot use a calendar, because that needs OAuth credentials for each user.
- There is no wake word. The voice stream goes to the OpenAI Realtime API.
- The agent does not start work by itself except through scheduled tasks.
