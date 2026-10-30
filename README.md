# RyanAI — Autonomous Reasoning Platform

RyanAI is a modular AI application for coordinating multiple reasoning providers, durable agent work, persistent state, and a web/API interface. The repository contains a React and Vite frontend, a Node.js and TypeScript API, PostgreSQL persistence, Redis, an HTTP Model Context Protocol (MCP) service, and supporting workflow and developer tooling.

> **Operational truth:** a passing build proves that the checked code builds; it does not prove that external model credentials work, a hosted service is healthy, a background worker is running continuously, or a deployment is production-ready. Verify each capability independently using the checks in this guide.

## Project status and release discipline

This README describes the current repository implementation and its intended local operating model. RyanAI is under active development. Treat provider connectivity, deployment readiness, and optional integrations as environment-dependent.

- Do not place secrets in source files, browser variables, issue comments, pull requests, or chat messages.
- Do not merge a change solely because a pull request exists or is marked mergeable. Review required checks for the exact head commit.
- Do not treat a skipped check, preview quota failure, missing credential, or unavailable external service as a successful test.
- Production promotion requires a reviewed change, green required checks, an approved database plan, configured secrets, and a verified health check.
- Autonomous execution is bounded by configured workers, queue availability, provider quotas, and infrastructure uptime. It is not an unlimited or guaranteed always-on service.

## Contents

- [Capabilities and architecture](#capabilities-and-architecture)
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
| `vercel.json` | Vercel configuration |

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
| `DATABASE_URL` | PostgreSQL connection string. |
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
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Optional server-side Supabase configuration. |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server-only credential. Never expose to the browser. |
| `VITE_SUPABASE_URL` | Public project URL compiled into the frontend when required. |
| `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Public/publishable frontend keys only. |

Never place a service-role key, provider secret, GitHub token, or signing secret in a `VITE_*` variable. Frontend variables are bundled into browser-delivered assets.

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

The three clients are configured in `src/config/brains.ts`. Provider credentials must be supplied to the server process or deployment secret store.

### Configuration is not connectivity

A non-empty environment variable does not prove that a key is valid. A configured endpoint does not prove that the provider is reachable. A healthy API process does not prove that a model can respond.

To verify a provider end to end:

1. Configure its credential in a trusted server-side environment.
2. Confirm the selected endpoint and model are correct.
3. Use the application's authenticated provider test or a controlled test request.
4. Confirm the provider returned a real response and record the timestamp, model, and outcome without logging secrets.
5. Repeat separately for NVIDIA, Qwen, and Logic.

Do not mark a brain connected based only on a readiness flag or mocked test. Never commit credentials or paste them into an issue, PR, log, or chat.

## Autonomous tasks, persistence, and recovery

The agent runtime includes durable run and handoff operations, bounded retry policy, mission orchestration, and PostgreSQL-backed checkpointing.

### Durable runs and retries

Agent runs are persisted rather than being represented only by in-memory promises. The retry policy uses bounded attempts and exponential backoff:

- Retry delays begin at 5 seconds.
- The delay increases exponentially.
- The delay is capped at 60 seconds.
- A run stops retrying when its configured attempt budget is exhausted.

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

## Database operations

Prisma schema and migration files are under `prisma/`.

Useful commands:

```bash
npm run db:generate
npm run db:migrate
npm run db:setup
```

- `db:generate` generates the Prisma client.
- `db:migrate` runs the repository migration entry point.
- `db:setup` generates the client and runs the migration entry point.

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

Deployment configuration is environment-specific. This repository includes Docker, Render Blueprint, and Vercel configuration, but a checked-in configuration file does not prove that a provider service is connected correctly or deployed.

### Docker deployment

For a production Docker deployment:

- Use a private network and TLS-terminating ingress.
- Store secrets in the host's secret manager, not in the image or repository.
- Use persistent, backed-up database storage.
- Restrict PostgreSQL, Redis, and MCP access to trusted networks.
- Configure resource limits, monitoring, log retention, and alerting.
- Apply reviewed database migrations before or alongside a compatible application release.
- Verify the actual health route and perform authenticated application smoke tests.

The default Compose port bindings are loopback-only and are intended for local use.

### Render

The repository includes `render.yaml` describing a static web service and a Docker API service. Before applying it:

1. Confirm the Render service is connected to the intended repository and branch.
2. Confirm service names, domains, Dockerfile path, build context, health route, and CORS origins.
3. Configure all required secrets in Render's environment settings.
4. Provision persistent database and Redis services appropriate for the workload; do not assume the local Compose services exist in Render.
5. Review the Blueprint diff before applying changes.
6. Enable auto-deploy only after the CI and release policy are in place.
7. Verify the resulting deployment, health check, logs, and external model calls.

Do not create duplicate services to work around a repository-link or service-configuration issue.

### Vercel

The repository also contains `vercel.json`. Confirm the Vercel project root, build settings, environment variables, and API origin. The frontend and API may be separate services; ensure the browser points to the intended HTTPS API origin and the API allows the exact frontend origin.

A Vercel preview or deployment can be blocked by account quotas or project permissions. Report those as infrastructure/provider blockers, not as a green production deployment.

### Release checklist

Before promoting a release, verify all of the following for the exact commit:

- [ ] Pull request reviewed and merged through the approved process.
- [ ] Required typecheck, lint, unit, integration, and E2E checks passed.
- [ ] Dependency, secret, CodeQL, and container security scans reviewed.
- [ ] Docker images built successfully for the intended targets.
- [ ] Database migration reviewed, tested, backed up, and approved.
- [ ] Production secrets configured in the deployment provider.
- [ ] NVIDIA, Qwen, and Logic provider calls tested with real credentials if those brains are part of the release.
- [ ] API, web, database, Redis, and MCP health checks verified.
- [ ] Authentication, authorization, and critical user journeys smoke-tested.
- [ ] Logs, monitoring, rollback plan, and service ownership confirmed.
- [ ] Deployment provider reports the intended revision as healthy.

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
