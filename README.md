# RyanAI — Autonomous Reasoning Platform

RyanAI is a modular AI application for coordinating multiple reasoning providers, durable agent work, persistent state, and a web/API interface. The repository contains a React and Vite frontend, a Node.js and TypeScript API, PostgreSQL persistence, Redis, an HTTP Model Context Protocol (MCP) service, and supporting workflow and developer tooling.


## Project status and release discipline

This README describes the current repository implementation and its intended local operating model. RyanAI is under active development. Treat provider connectivity, deployment readiness, and optional integrations as environment-dependent.

- Do not place secrets in source files, browser variables, issue comments, pull requests, or chat messages.
- Do not merge a change solely because a pull request exists or is marked mergeable. Review required checks for the exact head commit.
- Do not treat a skipped check, preview quota failure, missing credential, or unavailable external service as a successful test.
- Production promotion requires a reviewed change, green required checks, an approved database plan, configured secrets, and a verified health check.
- Autonomous execution is bounded by configured workers, queue availability, provider quotas, and infrastructure uptime. It is not an unlimited or guaranteed always-on service.

## RyanAI architecture and governance standard (7 November 2026)

RyanAI is designed to own its intelligence architecture. Models are replaceable specialists; evidence determines their value; deterministic security controls authorization; and human authority governs consequential actions.

| Domain | Responsibility | Non-negotiable boundary |
| --- | --- | --- |
| RyanAI Comms | Transcription, extraction, speech, and controlled communications workflows | Authenticated, bounded interfaces; drafts and analysis do not imply permission to send or call |
| Private RAG | Private document understanding, retrieval, and grounded answers | Owner-scoped access, source provenance, retention/deletion controls, and versioned embeddings |
| Gen-X Security | Independent authorization and enforcement | Authorization is deterministic and outside model/orchestrator control |
| Jarvis | Restricted engineering assistance, analysis, testing, and proposed corrections | No self-granted permissions, secret access, direct production deployment, or self-approval |

**Engineering acceptance rule:** every proposed change must demonstrate measurable benefit, security compliance, operational reversibility, and economic justification. Measure useful, verified outcomes per rand spent—not the number of models integrated.

**Model independence:** do not add a specialist because it is available or has an attractive published benchmark. Compare it with the current baseline on representative RyanAI tasks; pin its exact revision; isolate it; measure quality, reliability, latency, resource use, and total cost; and prove fallback, replacement, and rollback before promotion. Never mix embeddings from different models in one vector space.

**Authorization boundary:** models may classify, transcribe, extract, retrieve, summarize, or recommend. They cannot grant permissions, approve actions, retrieve secrets, bypass policy, merge code, or deploy. Gen-X and the trusted application authorization layer must enforce allowlists and permissions independently. Consequential actions require explicit human authorization.

**Economic measure:** cost per successful task is the fully attributable ZAR cost of compute, electricity, inference/provider usage, storage, amortized hardware, and maintenance divided by tasks that pass the defined quality and policy acceptance criteria. Report quality and failure rates beside cost; a cheap incorrect result is not useful intelligence.

See [the architecture reference](docs/ARCHITECTURE.md) and [the specialist model fit and adoption standard](docs/architecture/SPECIALIST_MODEL_FIT_AND_ADOPTION.md) for detailed design and benchmark gates.

## Contents

- [RyanAI architecture and governance standard](#ryanai-architecture-and-governance-standard-4-november-2026)
- [Current implementation status](#current-implementation-status)

- [Capabilities and architecture](#capabilities-and-architecture)
- [Specialist model evaluation](#specialist-model-evaluation)
- [Repository layout](#repository-layout)
- [Requirements](#requirements)
- [Quick start with Docker Compose](#quick-start-with-docker-compose)
- [Local development](#local-development)
- [Configuration](#configuration)
- [AI brains and provider connectivity](#ai-brains-and-provider-connectivity)
- [Autonomous tasks, persistence, and recovery](#autonomous-tasks-persistence-and-recovery)
- [MCP service](#mcp-service)
- [Self-patching and change safety](#self-patching-and-change-safety)
- [Database operations](#database-operations)
- [Commands and validation](#commands-and-validation)
- [Health checks and troubleshooting](#health-checks-and-troubleshooting)
- [Deployment](#deployment)
- [Security and secret handling](#security-and-secret-handling)
- [Contribution and pull-request workflow](#contribution-and-pull-request-workflow)
- [Known operational limits](#known-operational-limits)

## Current implementation status

**Documentation baseline: 7 November 2026 · official repository · `main` at `382f4ad2e44524cf6f9d362e6debd45f4234f0f1` (PR #1140).** This is a source and architecture baseline, not a production-readiness certificate. The commit history through this revision includes the Studio access/approval work (#1136–#1139), governed plugin registry and provider OAuth lifecycle work (#1132–#1135), and a Render build-blocker repair (#1140). Merged code and completed pull requests do not establish that hosted services, providers, workers, migrations, or every end-to-end user journey are healthy.

### Implemented foundations represented in the current source

- React/Vite web application and Node.js/TypeScript API, with a separate MCP service and workflow packages.
- PostgreSQL as the authoritative application and durable-memory store; pgvector is the vector-search foundation. Redis supports runtime coordination and caching, not authoritative long-term memory.
- Supabase remains the authentication and primary identity boundary. Keep the existing Supabase identity/storage relationship intact; optional audiobook persistence is a separate concern and does not replace the primary database.
- Three distinct configured reasoning roles (NVIDIA, Qwen, Logic) and an explicit local Ollama inference mode. Configuration and adapter code are not proof of provider connectivity or an installed/running local model.
- Durable agent-run, handoff, checkpoint, and engineering-evidence foundations. Pending work, worker-role metadata, and hash-chained records do not prove a worker is running or that evidence came from a trusted CI attestation.
- Owner-scoped RyanAI Studio workbench access for authenticated standard users, with exact plan/base-commit/proposed-diff approval binding and guarded execution paths.
- A server-side plugin registry and provider authorization lifecycle foundations for Google and Microsoft calendar connections, including PKCE/state handling, encrypted owner-bound token storage, scope validation, refresh/disconnect lifecycle, and safer callback handling.
- RyanAI Comms contracts and human-review checkpoint before outbound dispatch. Drafting, classification, transcription, and preparing a message do not authorize sending, calling, or provider dispatch.

### 7 November engineering updates

- **PR #1132 — governed plugin registry:** added a validated server-side provider manifest and authenticated read-only registry endpoint. Providers remain `adapter_required`; registry presence is not a connected state and does not expose executable adapter methods.
- **PR #1133 — secure authorization foundation:** added owner/provider-bound OAuth state and credential lifecycle primitives, encrypted credential storage design, strict endpoint/scope validation, audit events, and a proposed Prisma migration. The presence of migration files does not mean a production database migration has been applied.
- **PR #1134 and #1135 — Google/Microsoft OAuth lifecycle and hardening:** added provider-specific authorization-code/PKCE flows, one-use state, owner-bound encrypted tokens, scope checks, safe connection projections, refresh/disconnect handling, and callback/refresh failure hardening. Provider availability still depends on user consent and approved server-side configuration. No credential values are documented here.
- **PR #1136–#1139 — RyanAI Studio:** made Studio discoverable to authenticated standard users and aligned its API and coding-worker authorization with strict per-user workspace ownership. Approval is an authenticated owner action bound to the exact persisted plan hash, base commit SHA, and proposed diff hash; changing the plan invalidates the prior approval. This is not permission to bypass sandboxing, tests, review of resulting repository changes, CI, or deployment controls.
- **PR #1140 — Render build blockers:** repaired identified API/web build and Studio/settings integration blockers without production changes. This is a source/build repair, not evidence of a successful production deployment or healthy live service.

### RyanAI Studio: capability and limits

Studio is an authenticated engineering workspace available to standard signed-in users. The current governed workbench supports owner-scoped job visibility and management, plan/diff review, evidence inspection, and approval bound to the exact plan, base commit, and proposed diff. A plan change invalidates its earlier approval.

The execution adapter is required to use an isolated, resource-bounded workspace with deny-by-default network access and no inherited production credentials or host filesystem access. It must revalidate the exact approval binding before execution. A queued job or approved plan is not proof that a worker claimed or completed it.

**Do not describe Studio as a fully interactive cloud IDE/terminal unless the live implementation has been tested end to end.** Acceptance requires authenticated persistent sessions, real command execution, streamed stdout/stderr, exit codes, cancellation/interrupt, reconnect behavior, resource isolation, and actual TypeScript/Python build/test results. Never display simulated output or fabricated worker progress as real execution.

### Plugin and communications boundaries

The plugin registry is a catalogue, not an execution grant. Provider connections must be initiated by the authenticated owner through the approved OAuth flow; tokens remain server-side, encrypted, owner-bound, and absent from ordinary API responses and logs. Only declared least-privilege scopes may be requested. A successful OAuth callback does not prove every provider API operation or calendar workflow works.

Comms retains a separate human-review checkpoint before outbound dispatch. No agent, plugin, model, or orchestration service may self-authorize sending, calling, or other consequential external actions. Live delivery is not established by a draft, queued message, configured provider, or successful local test: verify provider callback and destination ownership, then obtain explicit authorization for the particular live test/action.

### Hosting and release posture

- **Render is the designated hosted application platform** for the RyanAI web/API delivery path. PR #1140 repairs source/build blockers; it does not authorize or prove a production deployment.
- **Railway is limited to isolated staging/backup evaluation** until its linked service, database, networking, health checks, data isolation, and recovery behavior are independently verified. A staging service is not production and is not evidence of failover readiness.
- **Vercel is not an approved RyanAI runtime/deployment target.** Do not add Vercel deployment, secrets, or infrastructure dependencies to the architecture.
- Supabase remains the primary identity/database/storage relationship. Keep audiobook-specific Neon persistence isolated and optional; do not silently redirect or replace core application data.
- Production deployments, production database migrations, secret changes/rotation, paid upgrades, and infrastructure changes require separate explicit authorization.

### Verification status and acceptance language

This documentation does not assert that the current API or web deployment is healthy, that PostgreSQL/pgvector migrations are production-ready, that Redis/worker execution is continuously available, that all inference providers authenticate, or that Google/Microsoft OAuth connections are active. Those facts require current, independent evidence.

For every release candidate, record the exact commit SHA and classify each check as **passed, failed, queued, skipped, cancelled, missing, or provider-blocked**. Only a completed successful check on the exact candidate SHA is a pass. A configured integration, merged PR, queued workflow, skipped scan, green build alone, or provider quota error must not be represented as end-to-end success.

Before Beta acceptance, verify at minimum:
1. Disposable/staging PostgreSQL and pgvector schema, migration, backup, and restore behavior.
2. API typecheck, tests, production build, Docker image build, and security scans on the exact candidate commit.
3. Enforceable `main` branch rules requiring reviewed PRs and required checks, blocking force-push/delete, and removing inappropriate bypass actors.
4. Render web/API health and authenticated smoke tests against the intended revision; independently verify any Railway staging target.
5. Authenticated owner isolation, memory access/deletion, plugin OAuth consent/refresh/disconnect, and Comms human-review/dispatch boundaries.
6. Real worker claim, lease/heartbeat, cancellation, retry, recovery, and isolated command execution—not just persisted jobs or queued status.
7. Real provider inference probes and offline specialist benchmarks with pinned model/data provenance, licence review, security gates, fallback, rollback, and ZAR cost per successful task.

No deployment, production migration, secret change, paid infrastructure upgrade, auto-merge, CI bypass, or model activation is implied by this README. Human review remains mandatory.

## Capabilities and architecture

### Main components

| Component | Responsibility | Local endpoint / location |
| --- | --- | --- |
| Web application | React UI, built with Vite | `http://localhost:1420` in development; `http://localhost:9090` in Compose |
| API | Fastify/Node.js application, application routes, auth, WebSockets, health checks, agent services | `http://localhost:3001` in development; `http://localhost:3000` in Compose |
| PostgreSQL | Durable application, agent-run, handoff, and memory records | `localhost:5432` |
| Redis | Runtime coordination/cache used by configured services | `localhost:6379` |
| MCP HTTP service | Model Context Protocol endpoint and health route | `http://localhost:8765/mcp`; `/health` |
| Workflow package | Separate workflow-oriented TypeScript package | `workflows-ryanai/` |

The Docker Compose stack places services on a private bridge network and binds published ports to loopback by default. This is appropriate for local development and inspection; it is not a substitute for a hardened production network design.

### Three reasoning brains

The API configures three OpenAI-compatible chat clients:

| Brain | Environment configuration | Intended role |
| --- | --- | --- |
| Primary / NVIDIA | `NVIDIA_API_KEY`, `NVIDIA_API_ENDPOINT`, `NVIDIA_MODEL` | Primary reasoning and analysis |
| Secondary / Qwen | `QWEN_API_KEY`, `QWEN_API_ENDPOINT`, `QWEN_MODEL` | Secondary analysis and additional context |
| Logic | `LOGIC_API_KEY`, `LOGIC_API_ENDPOINT`, `LOGIC_REASONING_MODEL` | Planning, structured reasoning, and synthesis |

The configured clients use OpenAI-compatible APIs. The exact models and endpoints are environment choices, not proof of provider availability. A valid API health response does not prove that any model provider can authenticate or complete an inference request.

### Application flow

At a high level:

1. The user interacts with the web application or an authorized API client.
2. The API validates the request and applies its authentication and authorization rules.
3. The configured reasoning client or orchestration service performs the requested work.
4. Durable task and memory data is stored in PostgreSQL where the relevant workflow uses persistence.
5. Redis and the configured worker/runtime services support coordination.
6. The MCP service exposes its separately configured protocol endpoint.

Not every route uses every component. Check the relevant module and route before assuming a capability depends on a particular service.

## Repository layout

The repository is larger than the core application. Important paths include:

| Path | Purpose |
| --- | --- |
| `src/` | Frontend, API, reasoning, agent orchestration, database, and application code |
| `src/agent/` | Durable agent-run operations, handoffs, and retry policy |
| `src/engine/` | Mission orchestration, task dispatch, checkpointing, and self-patch logic |
| `src/server/` | API server bootstrap and route registration |
| `src/config/brains.ts` | Construction of the three reasoning clients |
| `prisma/` | Prisma schema and database migrations |
| `mcp-server/` | Standalone MCP server package and HTTP/stdio transports |
| `workflows-ryanai/` | Separate workflow package |
| `workflows/` | Workflow source and validation |
| `scripts/` | Setup, validation, health, audit, and developer scripts |
| `.github/workflows/` | GitHub Actions CI, security, build, and release workflows |
| `docker-compose.yml` | Local multi-service stack |
| `Dockerfile` | Main application image targets |
| `Dockerfile.api` | API Docker build used by the Render Blueprint |
| `render.yaml` | Render Blueprint definition |

Use the checked-in source and workflow definitions as the authority when a document or deployment dashboard disagrees with this guide.

## Requirements

### Core development

- Git.
- Node.js **24.x** for the root application.
- npm **10 or newer**.
- Network access to install dependencies from the committed lockfiles.

The root `package.json` declares Node.js 24.x and npm 10.9.2. The MCP package has its own engine declaration; use the root Node.js version when developing the complete repository.

### Docker Compose

- Docker Engine.
- Docker Compose v2 (`docker compose`).
- Sufficient disk space and memory for the web, API, MCP, PostgreSQL, and Redis containers.

### Optional tooling

- Python 3.10+ for Python-based utilities and examples.
- Rust/Cargo and the platform-native build toolchain for Tauri or native modules.
- A configured AI provider account for live model calls.
- Supabase, Sentry, email, SMS, or other integration accounts only when enabling the corresponding integration.

## Quick start with Docker Compose

The Compose stack is the most repeatable way to run the web app, API, MCP server, PostgreSQL, and Redis together.

### 1. Clone the repository

```bash
git clone https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat.git
cd RYANAI-Automous-Reasioning-Plat
```

### 2. Create the local environment file

PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Edit `.env` and replace the required placeholders:

- `DB_PASSWORD`
- `REDIS_PASSWORD`
- `JWT_SECRET`
- `MCP_AUTH_TOKEN`

Use unique, cryptographically random values. The Compose connection strings interpolate the database and Redis passwords into URLs, so use URL-safe/hex values or correctly percent-encode reserved characters. Do not reuse one secret for multiple services.

Generate a random URL-safe secret with Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run it separately for each secret. Do not paste the generated values into source control.

### 3. Install dependencies (optional for Docker-only use)

If you intend to run scripts or develop locally:

```bash
npm run install:all
```

This installs the root, MCP, and workflow packages from their lockfiles. For only the root package:

```bash
npm ci --legacy-peer-deps
```

### 4. Build and start the stack

```bash
docker compose up --build --detach --wait
```

Or:

```bash
npm run docker:up
```

### 5. Verify services

```bash
docker compose ps
docker compose logs --tail=200 api web mcp-server postgres redis
```

Open the web application:

- Web UI: [http://localhost:9090](http://localhost:9090)
- API health: [http://localhost:3000/health](http://localhost:3000/health)
- MCP health: [http://localhost:8765/health](http://localhost:8765/health)
- MCP endpoint: [http://localhost:8765/mcp](http://localhost:8765/mcp)

PostgreSQL and Redis are published on loopback ports 5432 and 6379 for local tools. MCP operations require the configured bearer token.

### Stop and restart

```bash
# Stop containers but keep named volumes
docker compose down

# Start again
docker compose up --detach --wait

# Follow logs
docker compose logs --follow

# Rebuild images
docker compose build --no-cache
docker compose up --detach --wait
```

**Data warning:** `docker compose down -v` deletes the named database and Redis volumes. Use it only when you intentionally want to erase local persisted data.

## Local development

Use local development when editing source with hot reload. Start PostgreSQL and Redis first, either through Compose or through your own local services.

### 1. Install packages

```bash
npm run install:all
```

### 2. Configure the root `.env`

A minimal local example:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3001
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/ryanai_db
REDIS_URL=redis://:PASSWORD@127.0.0.1:6379
JWT_SECRET=replace_with_a_unique_random_secret
```

Adjust the database and Redis URLs to match your local services. If Redis has no password, use `redis://127.0.0.1:6379`.

### 3. Generate the Prisma client and prepare a development database

```bash
npm run db:generate
npm run db:migrate
```

Use only a disposable or backed-up development database until the migration procedure has been reviewed for the target environment.

### 4. Start the development services

```bash
npm run dev
```

The root development script starts the API, web frontend, and MCP HTTP service. Open [http://localhost:1420](http://localhost:1420).

### Start individual services

```bash
npm run dev:api
npm run dev:web
npm run dev:mcp
```

Do not start an individual service on the same port while the combined `npm run dev` process is already running.

## Configuration

The tracked [`.env.example`](.env.example) is the canonical starting template. It contains blank provider credentials and placeholder local secrets. Copy it to `.env`; never commit the populated file.

### Core variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime mode; use `development` locally and `production` for deployment. |
| `HOST`, `PORT` | API bind address and port. |
| `DATABASE_URL` | PostgreSQL connection string for the existing RyanAI platform database. |\n| `AUDIOBOOK_DATABASE_URL` | Optional pooled Neon connection used only by audiobook API/worker persistence. Does not replace `DATABASE_URL`. |\n| `AUDIOBOOK_DATABASE_URL_UNPOOLED` | Optional direct Neon connection used only by audiobook migrations and other session-level operations. |
| `REDIS_URL` | Redis connection string. |
| `JWT_SECRET` | Server-side signing/authentication secret. |
| `CORS_ORIGINS` | Comma-separated exact browser origins permitted by the API. |
| `VITE_API_BASE_URL` | Frontend API origin. Blank uses same-origin proxying in supported local/Compose setups. |
| `VITE_APP_ENV` | Frontend environment label. |

### AI provider variables

| Variable | Purpose |
| --- | --- |
| `NVIDIA_API_KEY` | Server-side NVIDIA provider credential. |
| `NVIDIA_API_ENDPOINT` | NVIDIA-compatible API base URL. |
| `NVIDIA_MODEL` / `PRIMARY_REASONING_MODEL` | Primary model selection. |
| `QWEN_API_KEY` | Server-side Qwen/Together-compatible credential. |
| `QWEN_API_ENDPOINT` | Qwen-compatible API base URL. |
| `QWEN_MODEL` / `SECONDARY_REASONING_MODEL` | Secondary model selection. |
| `LOGIC_API_KEY` | Logic brain credential. |
| `LOGIC_API_ENDPOINT` | Explicit Logic API endpoint. |
| `LOGIC_REASONING_MODEL` | Logic model selection. |
| `OPENAI_API_KEY` | Optional OpenAI credential used by OpenAI-compatible features. |
| `OPENAI_BASE_URL`, `OPENAI_MODEL` | Optional OpenAI-compatible endpoint and model. |
| `LM_STUDIO_URL`, `LM_STUDIO_API_KEY`, `LM_STUDIO_MODEL` | Optional local LM Studio configuration where supported. |
| `OLLAMA_URL` | Optional local Ollama-compatible endpoint where supported. |

The Logic client gives `LOGIC_API_ENDPOINT` first priority, then `OPENAI_BASE_URL`, then `LM_STUDIO_URL`, then its default endpoint. Configure one intended endpoint explicitly in production to avoid ambiguity.

### Database and browser integrations

| Variable | Purpose / handling |
| --- | --- |
| `SUPABASE_SESSION_POOLER_HOST` | Exact Supabase Shared Pooler Session hostname copied from the project's Connect dialog; do not infer the cluster index from the region. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Supabase Auth endpoint and server-side publishable key used to verify user sessions. |
| `SUPABASE_ANON_KEY` | Legacy public key alias retained where needed. |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server-only credential. Never expose to the browser. |
| `VITE_SUPABASE_URL` | Public project URL compiled into the frontend when required. |
| `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Public/publishable frontend keys only. |

Never place a service-role key, provider secret, GitHub token, or signing secret in a `VITE_*` variable. Frontend variables are bundled into browser-delivered assets.

For Render's IPv4-only API network, copy the **Session pooler** hostname from the Supabase project's **Connect** dialog and set that hostname (host only, no scheme or port) as `SUPABASE_SESSION_POOLER_HOST` on the existing `ryanai-api` service. Do not construct the `aws-[index]-[region]` host from the region: Supabase assigns a pooler cluster index that cannot be inferred from the region. The API resolver uses port `5432` and the project-qualified shared-pooler user `postgres.[PROJECT_REF]`; keep the original database password only in the protected `DATABASE_URL` setting.

### MCP variables

| Variable | Purpose |
| --- | --- |
| `MCP_HOST`, `MCP_PORT` | MCP HTTP bind host and port. |
| `MCP_AUTH_TOKEN` | Bearer token protecting MCP operations. |
| `MCP_ALLOWED_HOSTS` | Narrow comma-separated host allowlist. |

### Self-patching variables

| Variable | Purpose |
| --- | --- |
| `RYANAI_GITHUB_TOKEN` | Fine-grained, repository-scoped GitHub token used by the patch proposal service. |
| `RYANAI_GITHUB_REPOSITORY` | Target repository in `owner/name` format. |
| `RYANAI_GITHUB_BASE_BRANCH` | Base branch; defaults to `main`. |
| `RYAN_PATCH_VERIFIER_IMAGE` | Optional immutable verifier image configuration for local isolated patch verification. |

Use a fine-grained GitHub token limited to this repository, with only the required Contents and Pull Requests permissions. Do not use a broad personal access token. Do not enable self-patching until repository rules, token scope, audit visibility, and CI requirements have been reviewed.

### Optional integrations

The following are optional and should remain disabled/unconfigured unless deliberately enabled:

- Jarvis: `JARVIS_BASE_URL`, `JARVIS_API_TOKEN`, `JARVIS_SYNC_ENABLED`, `JARVIS_ALLOW_PRODUCTION_SYNC`, `JARVIS_PATCH_INGRESS_ENABLED`, `JARVIS_INGRESS_TOKEN`, and the configured route paths.
- Test-only access: `TEST_ADMIN_ACCESS_TOKEN` for authenticated integration paths. Use a dedicated non-production test token.
- Integration test endpoints/timeouts: `API_BASE_URL`, `WEB_URL`, `WEB_BASE_URL`, `MCP_URL`, `INTEGRATION_TIMEOUT_MS`, and `API_TIMEOUT`.
- Monitoring, email, SMS, and other provider-specific settings: configure only for the integration being used.

## AI brains and provider connectivity

The existing NVIDIA, Qwen, and Logic reasoning roles remain independently configured. The shared model factory in `src/config/llm.ts` also has an explicit local Ollama mode introduced by PR #864. Provider credentials, when required, belong only in the trusted server-side environment.

### Configuration is not connectivity

A non-empty environment variable does not prove that a key is valid. A configured endpoint does not prove that the provider is reachable. A healthy API process does not prove that a model can respond.

To verify a provider end to end:

1. Configure its credential in a trusted server-side environment.
2. Confirm the selected endpoint and model are correct.
3. Use the application's authenticated provider test or a controlled test request.
4. Confirm the provider returned a real response and record the timestamp, model, and outcome without logging secrets.
5. Repeat separately for NVIDIA, Qwen, and Logic.

### Local Ollama inference

Local mode is opt-in and requires both `OLLAMA_URL` and `OLLAMA_MODEL` with `RYANAI_INFERENCE_MODE=local`. The adapter validates the endpoint and is intended to fail closed rather than use a remote/cloud fallback. Configuration alone is not runtime evidence: verify that the local Ollama process is running, the pinned model is installed, and a real inference request succeeds. Do not expose local inference endpoints to untrusted networks.

Do not mark a brain connected based only on a readiness flag or mocked test. Never commit credentials or paste them into an issue, PR, log, or chat.

## Specialist model evaluation

RyanAI should add only specialists that demonstrate a measurable improvement over an existing baseline. The current candidate policy prioritizes offline evaluation of GLiNER extraction, EmbeddingGemma retrieval, and PaddleOCR-VL document parsing. Parakeet ASR and Kokoro TTS remain conditional on language-specific tests. Arch-Router is deferred pending licence review and comparison with deterministic routing; research-only Nemotron-Orchestrator-8B is excluded from production under the terms described in the evaluation proposal.

Benchmark document parsing, extraction, and embeddings separately from transcription and speech. For speech, report `en-ZA` and `ve-ZA` independently; a model's general multilingual claim does not establish Tshivenda quality. Use representative, consented, access-controlled evaluation data and record exact model revision, runtime, hardware, quantization, dataset, and prompt versions.

Minimum measurements include OCR field-level precision/recall/F1 and character error rate; extraction precision/recall/F1, calibration, and source provenance; retrieval Recall@k, nDCG@k, and MRR; ASR WER/CER and named-term accuracy by language; and TTS blinded intelligibility, pronunciation, and naturalness assessments. Across all workloads measure p50/p95 latency, throughput, peak RAM/VRAM, failures, abstentions, fallback frequency, and total cost per successful task in ZAR.

Run candidate models behind replaceable, versioned adapters. Keep the current model as a fallback; test timeouts, unsupported inputs, low confidence, model unavailability, and malformed outputs. Keep embedding indexes versioned and isolated—never mix incompatible vector spaces. Preserve the prior index and model revision until rollback has been exercised. See [the specialist adoption standard](docs/architecture/SPECIALIST_MODEL_FIT_AND_ADOPTION.md).

## Identity, language, and voice preferences

RyanAI includes a configurable greeting and language preference experience.

### Language options

The language registry in `src/shared/languages.ts` includes all 11 South African official languages:

- Afrikaans (`af-ZA`)
- English (South Africa) (`en-ZA`)
- Sepedi / Northern Sotho (`nso-ZA`)
- isiNdebele (`nr-ZA`)
- isiXhosa (`xh-ZA`)
- isiZulu (`zu-ZA`)
- Sesotho (`st-ZA`)
- Setswana (`tn-ZA`)
- siSwati (`ss-ZA`)
- Tshivenda / Venda (`ve-ZA`)
- Xitsonga (`ts-ZA`)

International options include English (UK and US), French, Portuguese (Brazil), Spanish, German, Mandarin Chinese, Japanese, Hindi, Arabic, and Swahili.

- The default language for other accounts is South African English (`en-ZA`).
- The owner default is Tshivenda/Venda (`ve-ZA`).
- Other users can select and persist their own language preference in the greeting controls.
- Language instructions ask the reasoning system to preserve names, code, URLs, dates, numbers, and technical/security terminology accurately.

### Greeting and preferred form of address

The greeting component supports a configurable preferred title. The owner defaults to **Sir G**; other accounts default to their display name. The owner communication instruction uses `RYANAI_OWNER_TITLE` (default `Sir G`) and `RYANAI_OWNER_LANGUAGE` (default `ve-ZA`) for server-side owner responses.

### Voice behavior and limitations

- The greeting UI uses the browser/device Speech Synthesis API and lets users select an installed voice matching their selected locale.
- Voice playback can be enabled or disabled, and a greeting can be played manually.
- The realtime voice API requires an authenticated, single-use short-lived voice ticket and Redis.
- Realtime provider access requires the server-side `OPENAI_API_KEY`; the default realtime model is configured by `RYANAI_REALTIME_MODEL`.
- Actual voice availability, pronunciation, accent quality, and language coverage depend on the device's installed speech voices and the upstream realtime provider. A language appearing in the selector does not guarantee that every device has a native voice for it. The UI reports when no matching device voice is installed and may fall back to a device default.

Do not place voice-provider credentials in frontend variables. For hosted deployments, configure them only in the trusted server secret store.

## Autonomous tasks, persistence, and recovery

The agent runtime includes durable run and handoff operations, bounded retry policy, mission orchestration, and PostgreSQL-backed checkpointing.

### Durable runs and retries

Agent runs are persisted rather than being represented only by in-memory promises. The retry policy uses bounded attempts and exponential backoff:

- Retry delays begin at 5 seconds.
- The delay increases exponentially.
- The delay is capped at 60 seconds.
- A run stops retrying when its configured attempt budget is exhausted.
- Active workers refresh their three-minute lease every 30 seconds.
- Worker ID and claim-attempt fencing prevent an expired worker from committing a stale result after another worker has reclaimed the run.

A durable queue still requires a running worker, a reachable database, correct deployment configuration, and sufficient infrastructure capacity. A persisted pending run will not execute while no worker is available.

### Checkpoint recovery

The checkpointer stores JSON state in agent memory records associated with a session and a checkpoint step. Recovery:

- Queries only records for the requested session and checkpoint record prefix.
- Checks step identifiers and metadata consistency.
- Rejects oversized or malformed checkpoint content.
- Searches recent candidates so a corrupt newest row does not automatically hide an older valid checkpoint.

Checkpoint recovery is not a substitute for database backups. Keep backups and test restore procedures.

### Mission planning and execution safety

Task plans are validated at planning and execution boundaries. Restored plans are revalidated before a mission can resume. Current task dispatch is intended for bounded analysis tasks assigned to the configured reasoning brains; it is not a general-purpose shell executor.

Do not expand autonomous permissions to file writes, deployments, credential access, or arbitrary tool execution without a separate threat model, authorization model, and tests.

## MCP service

The repository includes a separate MCP package in `mcp-server/`.

Supported launch modes:

```bash
# Standard stdio transport
npm run mcp:start

# HTTP transport
npm run mcp:http

# Source/dependency checks
npm run mcp:check

# Health probe
npm run mcp:health
```

With Compose, the MCP HTTP service is available at `http://localhost:8765/mcp` and its health endpoint at `http://localhost:8765/health`. Use the configured bearer token for MCP requests. Restrict allowed hosts and network exposure to the minimum required.

## Self-patching and change safety

The production self-patch path is designed to propose a GitHub pull request rather than modify the running container directly.

The current implementation:

- Requires administrator authorization at the API route.
- Applies path and content validation.
- Limits changes to approved source directories.
- Rejects protected paths, credential-like content, and unsupported file targets.
- Requires an existing regular tracked file and rejects symlink/special-file targets.
- Creates an isolated Git branch and pull request through the GitHub API.
- States that the proposal has not been deployed or promoted.

The self-patch service does **not** make a patch production-ready. The normal review, CI, security, branch-protection, merge, and deployment process must still apply. The local patch-verification path is distinct from the production PR-proposal path.

### Jarvis governance and independent authorization

Jarvis is a restricted engineering assistant, not an authorization authority. It may inspect, analyse, test, prepare a patch, and propose a pull request only within explicitly granted permissions. Expand its capabilities only after independent verification of the authenticated identity, least-privilege permissions, execution isolation, command/path/network boundaries, audit evidence, and recovery procedure. A model-generated plan or a successful tool response is not approval.

Gen-X and the trusted application policy layer must enforce authorization independently of Jarvis, specialist models, and orchestration. No model or orchestrator may grant itself permissions, access secrets, approve its own work, bypass review, merge a change, or deploy to production. Consequential actions require explicit human authorization. Keep analysis/draft permissions separate from write, send, merge, and deploy permissions.

## Database operations

Prisma schema and migration files are under `prisma/`.

Useful commands:

```bash
npm run db:generate
npm run db:migrate
npm run db:setup

# Separate Neon audiobook database (only when explicitly configured/approved):
npm run db:audiobook:generate
npm run db:audiobook:status
# Review target branch and pending migration before running:
npm run db:audiobook:migrate
```

- `db:generate` generates both the platform Prisma client and the isolated audiobook client.
- `db:migrate` runs the existing platform migration entry point.
- `db:setup` generates both clients and runs only the existing platform migration entry point.
- `db:audiobook:status` and `db:audiobook:migrate` operate only on `AUDIOBOOK_DATABASE_URL_UNPOOLED` via the separate `prisma/audiobook/` migration history. Do not point them at the main platform database or a production branch.

For local development, inspect the migration runner and target database before applying changes. Never use `prisma db push` or a destructive reset against production as a shortcut. Before a production schema change:

1. Review the Prisma schema and migration SQL.
2. Back up the database and verify the restore procedure.
3. Test the migration against a disposable database with a production-like schema.
4. Confirm backward compatibility with the application version being deployed.
5. Apply through the approved release process and verify application health.

## Commands and validation

Run commands from the repository root.

### Development and build

| Command | Purpose |
| --- | --- |
| `npm run install:all` | Install root, MCP, and workflow dependencies from lockfiles. |
| `npm run dev` | Start API, web, and MCP HTTP services together. |
| `npm run dev:api` | Start the API in development/watch mode. |
| `npm run dev:web` | Start the Vite frontend. |
| `npm run dev:mcp` | Start the MCP HTTP service. |
| `npm run build` | Type-check and build the frontend. |
| `npm run build:server` | Compile the API/server and copy runtime assets. |
| `npm run start` | Start the built API server. |
| `npm run lint` | Run ESLint with warnings treated as errors. |

### Tests and validation

| Command | Purpose |
| --- | --- |
| `npm test` | Run the configured Vitest suite. |
| `npm run test:e2e` | Run the end-to-end flow script; requires its expected services/configuration. |
| `npm run test:integration` | Run local integration checks. |
| `npm run test:agent-operations` | Run focused agent operations tests. |
| `npm run test:stack-validator` | Test stack-manifest validation. |
| `npm run test:workflows` | Run workflow tests. |
| `npm run workflows:check` | Type-check workflow source. |
| `npm run validate` | Run repository checks, tests, type checks, lint, and builds. |
| `npm run ship` | Run validation, then build Docker images. |

Some tests are conditional on external services or dedicated test credentials. A reported skip must remain a skip in release notes; do not count it as a pass for the skipped capability.

### Docker and diagnostics

| Command | Purpose |
| --- | --- |
| `npm run docker:up` | Build and start Compose services, waiting for health checks. |
| `npm run docker:ps` | Show Compose service status. |
| `npm run docker:logs` | Follow Compose logs. |
| `npm run docker:health` | Query API health from the API container. |
| `npm run docker:build` | Rebuild Compose images without cache. |
| `npm run docker:down` | Stop Compose services without deleting volumes. |
| `npm run startup:verify` | Run startup verification. |
| `npm run audit:inspector` | Run the release/AI inspector audit. |
| `npm run audit:deployments` | Run deployment readiness audit. |
| `npm run audit:agents` | Run agent readiness audit. |
| `npm run workflow:validate` | Validate GitHub workflow definitions. |
| `npm run stack:validate` | Validate the stack manifest. |
| `npm run mcp:check` | Check MCP source and dependency policy. |

### Recommended pre-PR local sequence

```bash
npm ci --legacy-peer-deps
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run validate
```

Run Docker builds and integration tests when the change affects containers, service wiring, database access, or cross-service behavior.

## Health checks and troubleshooting

### Check container state

```bash
docker compose ps
docker compose logs --tail=200 api web mcp-server postgres redis
```

### Probe local services

macOS/Linux:

```bash
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:9090/health
curl --fail http://127.0.0.1:8765/health
```

PowerShell:

```powershell
Invoke-WebRequest http://127.0.0.1:3000/health
Invoke-WebRequest http://127.0.0.1:9090/health
Invoke-WebRequest http://127.0.0.1:8765/health
```

Health endpoints show whether a process or its configured dependencies respond. They do not prove model inference, user authentication, billing status, or external integrations are working.

### Common problems

**Docker reports a missing required variable**

- Confirm that `.env` exists in the repository root.
- Check that the four required Compose secrets are populated.
- Re-run `docker compose config` to identify interpolation errors.
- Do not share the contents of `.env` when asking for help.

**API starts but model requests fail**

- Check which brain and endpoint the feature selected.
- Confirm the server-side credential is present in the API container.
- Verify the model name, provider account, quota, and network access.
- Inspect redacted error details; never print the credential itself.
- Test each brain separately.

**Database connection fails**

- Confirm PostgreSQL is healthy with `docker compose ps`.
- Verify `DATABASE_URL` points to the correct host from the process making the connection. Inside Compose, use the service hostname `postgres`; from the host, use `127.0.0.1`.
- Check database logs and connection limits.

**Redis connection fails**

- Confirm the Redis container is healthy.
- Verify the URL includes the correct password and host for the caller's network.
- Do not confuse the host's loopback address with the Compose service hostname `redis`.

**Port already in use**

- Stop the other process or change the relevant port mapping.
- Avoid running the combined development script and individual services simultaneously.

**Windows native dependency installation fails**

- Use the Node.js 24.x runtime declared by the root package.
- Close processes that may lock native modules.
- Retry the exact failing npm command and preserve the first error output.
- Do not delete lockfiles or switch package managers without diagnosing the failure.

**A CI or preview workflow is queued, skipped, or blocked**

- Inspect the workflow run for the exact commit.
- Distinguish code-test failures from external quota, permission, or deployment-provider failures.
- A preview quota limit is not a successful deployment and is not necessarily an application build failure.

## Deployment

**Approved architecture:** Render is the designated hosted platform for the RyanAI web/API delivery path. Railway is restricted to isolated staging or backup evaluation until independently validated. Vercel is not an approved RyanAI runtime or deployment target. Docker Compose remains the reproducible local development stack.

Pull-request deployments, where configured, are staging-only and must be bound to the exact open PR head and completed required CI/security checks. A staging deployment does not authorize production promotion. Production deployment requires a separate explicit approval.

### Render — designated hosted platform

The repository includes a Render Blueprint for the web and API services. Treat the Blueprint and dashboard as configuration inputs that must be reconciled, not as proof of a healthy deployment.

Before any authorized change:
1. Confirm the service is connected to the official `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat` repository and intended branch.
2. Review the exact Blueprint diff, service names, Dockerfile/build context, publish path, health route, CORS origins, and environment-variable references.
3. Confirm database connectivity through the exact Supabase-provided Session Pooler hostname where required; never infer or guess a pooler hostname.
4. Confirm Redis/Valkey connectivity independently.
5. Keep schema migrations separate from API startup and require a separately reviewed, approved migration plan.
6. Verify build, deploy revision, `/health`, authenticated application journeys, logs, and real provider probes independently.
7. Keep auto-deploy disabled unless the release process and exact-head protections have been verified.

PR #1140 repaired source/build blockers without production changes. It does not establish a completed deployment, healthy API, successful database connection, or verified end-to-end product.

### Railway — isolated staging/backup evaluation only

Railway may be used for a dedicated, isolated staging or backup evaluation of API/Docker workloads. Do not treat a linked staging service as production or as a proven failover target. Before considering it operational, verify the official repository/branch, isolated environment, database and storage separation, network policy, secrets scope, health checks, persistence, backup/restore, and recovery behavior. Do not repurpose unrelated Railway projects or connect staging to production data.

### Production release checklist

For the exact candidate commit, require:
- [ ] Human-reviewed pull request; no auto-merge or bypass.
- [ ] Required typecheck, lint, unit, integration, and relevant end-to-end checks completed successfully.
- [ ] Dependency, secret, CodeQL, container, and supply-chain scans reviewed; skipped or missing scans are not passes.
- [ ] Web and API builds and Docker image builds completed successfully.
- [ ] Database migration reviewed and tested on disposable/staging data; separate explicit approval before any production migration.
- [ ] Production secrets already provisioned through approved secret stores; no secret values in source or logs.
- [ ] Real provider calls tested only where authorized and required for the release.
- [ ] API, web, PostgreSQL, Redis, and MCP health independently verified.
- [ ] Authentication, authorization, owner isolation, critical user journeys, and outbound-communications approval tested.
- [ ] Monitoring, rollback, backup/restore, and service ownership confirmed.
- [ ] Explicit production deployment approval recorded before promotion.

## Security and secret handling

Security is part of the release process, not a one-time scan.

### Secrets

- Keep `.env`, private keys, provider tokens, signing secrets, and service-role keys out of Git.
- Use deployment secret stores for hosted services.
- Never expose server credentials through frontend `VITE_*` variables.
- Rotate a credential immediately if it may have been published. Removing it from the latest commit does not revoke it or erase it from Git history.
- Review provider usage and audit logs after suspected exposure.
- Use separate credentials for development, testing, and production.

### Access and network controls

- Require authentication for administrative routes.
- Use least-privilege service accounts and repository tokens.
- Keep databases and Redis off the public internet.
- Limit CORS origins and MCP host allowlists.
- Apply request size limits, rate limits, timeouts, and bounded retry policies.
- Keep patch proposal and production promotion as separate permissions.

### Autonomous execution

- Treat user objectives, model output, checkpoint data, and task payloads as untrusted input.
- Validate plans at execution boundaries, not only when they are first generated.
- Keep retries bounded and make operations idempotent where possible.
- Record task attempts, handoffs, failures, and recovery outcomes.
- Do not grant agents unrestricted shell, filesystem, network, credential, or deployment access by default.

## Contribution and pull-request workflow

1. Start from the latest `main`.
2. Create a narrowly scoped branch.
3. Make the smallest coherent change.
4. Add or update tests for the changed behavior, including failure paths.
5. Run the relevant local checks.
6. Open a pull request with the problem, implementation, test evidence, security impact, and any operational prerequisites.
7. Wait for the required checks on the exact PR head commit.
8. Review all failures, skips, and provider-side blockers before merge.
9. Confirm the merged commit and deployment separately.

Suggested branch names:

- `fix/<short-description>`
- `feat/<short-description>`
- `docs/<short-description>`
- `test/<short-description>`

### Repository rules

The repository's branch/ruleset configuration must enforce the intended merge policy. Maintainers should ensure the active ruleset targets `main`, requires pull requests, requires the agreed status checks, blocks force pushes, and restricts bypass permissions. If the ruleset is disabled or required checks are not configured, merging must be treated as a manual exception—not as evidence that the branch was protected.

## Known operational limits

- Model providers require valid credentials, reachable endpoints, available models, and sufficient account quota.
- Workers require an active process and infrastructure capacity; persisted tasks do not run themselves while workers are stopped.
- Database persistence does not replace backups, restore drills, or data-retention policies.
- MCP health does not prove that every MCP operation or external integration is authorized and functioning.
- The self-patch feature proposes GitHub pull requests; it does not bypass review, CI, branch protection, or deployment.
- Local Docker Compose settings are not automatically production-safe.
- A passing CI run does not prove production runtime health.
- Optional integrations remain inactive until their credentials, permissions, endpoints, and feature flags are configured and tested.

## License and project information

Check the repository's license and notices before redistributing or deploying the software. If no license file is present, do not assume that the code is licensed for unrestricted reuse.

For bugs and feature proposals, open a GitHub issue with a concise reproduction, expected behavior, actual behavior, and redacted logs. Never attach credentials, populated environment files, private customer data, or production database dumps.


## Supabase OAuth 2.1 Server

RyanAI provides an explicit Supabase OAuth consent UI at `/oauth/consent`. The hosted Supabase project must have OAuth Server enabled and its authorization path set to `/oauth/consent`; client registration and the remaining setup steps are documented in [Supabase OAuth Server setup](docs/SUPABASE_OAUTH_SERVER.md). Dynamic registration remains disabled by default.


## Universal model governance (RIIP)

RyanAI uses the **RyanAI Intelligence Improvement Protocol (RIIP)** as its shared model-governance baseline. The machine-readable policy and model registry live in `governance/model-governance.yaml`; the operational contract is documented in [RIIP Universal Model Governance](docs/architecture/RIIP-UNIVERSAL-MODEL-GOVERNANCE.md).

- Every reasoning provider, local inference adapter, and specialist model must have an explicit role, task-family scope, status, and evaluation requirement.
- Provider configuration is not proof of connectivity or successful inference. Runtime verification is recorded separately.
- Model output is untrusted. Models cannot authorize actions, change their own permissions, approve their own changes, merge, deploy, or promote themselves.
- Gen-X remains the independent authorization enforcement boundary; consequential actions require human approval.
- Model changes require a held-out baseline, security/licence review, tested rollback, and cost per accepted successful task in ZAR.
- Specialist candidates remain evaluation-only until their exact checkpoint, workload, security, language, licence, operational, and economic gates are independently satisfied.

Run `npm run model-governance:validate` and `npm run test:model-governance` to validate the policy contract. These checks validate policy structure and invariants; they do not prove provider connectivity, model quality, production isolation, or live rollback.

copyright ©️ 2026 RMN Ganyane Uncle Security Services _ rmnganyane-dev _ SirG's 2024-26

MIT License

Copyright (c) 2026 Ntsiyeni Ganyane

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Security Policy
RyanAI accepts vulnerability reports for the application, API, workflow services, MCP service, deployment configuration, and dependency supply chain.

Supported versions
Security fixes are made against the latest code on the main branch. There are currently no numbered, supported release lines; releases should be treated as unsupported unless explicitly documented otherwise.

Version	Support status
Latest main	Security fixes are reviewed here
Published releases	Support status is stated in the release notes
Older commits and unmaintained forks	Not guaranteed
Reporting a vulnerability
Please do not report exploitable vulnerabilities in public issues or pull requests. Use GitHub's private vulnerability reporting feature for this repository, if available. If private reporting is unavailable, contact the repository maintainers through the private contact method listed in the GitHub organization profile. Include a safe reproduction, affected commit or version, impact, and suggested mitigation where possible.

Do not include live credentials, customer data, production tokens, or destructive proof-of-concept payloads in a report.

What to expect
The maintainers will acknowledge a report as soon as reasonably possible.
We will attempt to reproduce and assess its severity and scope.
We will coordinate a fix and disclosure timeline with the reporter where practical.
A report may be declined if it cannot be reproduced, is out of scope, or describes expected behavior; where possible, the reason will be explained.
Please allow maintainers reasonable time to investigate before public disclosure. Do not test against systems or accounts you do not own or have explicit permission to assess.

Deployment security
Keep secrets in a secret manager or protected environment variables; never commit .env files.
Rotate credentials immediately if they may have been exposed.
Restrict database, Redis, API and MCP access to trusted networks.
Keep optional integrations and production write/sync operations disabled until explicitly reviewed.
