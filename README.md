# RyanAI — Autonomous Reasoning Platform

RyanAI is a full-stack autonomous reasoning platform composed of a React/Vite web application, a Node.js/TypeScript API, PostgreSQL with pgvector, Redis, and a standalone Model Context Protocol (MCP) HTTP service. The repository also contains agent/workflow tooling, stack validators, and optional integrations with external AI providers and Jarvis.

> **Project status:** this README documents the repository's current code and scripts. A successful build or CI run does not, by itself, prove every external provider, credential-dependent feature, or production deployment is operational. Check the live GitHub Actions runs and your deployment provider before promoting a release.

## Contents

- [System overview](#system-overview)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration and environment variables](#configuration-and-environment-variables)
- [Run with Docker Compose](#run-with-docker-compose-recommended)
- [Run in local development mode](#run-in-local-development-mode)
- [Setup and database](#setup-and-database)
- [Operation and useful commands](#operation-and-useful-commands)
- [Health checks and testing](#health-checks-and-testing)
- [Deployment notes](#deployment-notes)
- [Security guidance](#security-guidance)
- [Troubleshooting](#troubleshooting)

## System overview

| Component | Purpose | Default local endpoint |
| --- | --- | --- |
| Web UI | React/Vite frontend, served by Vite in development or Nginx in the container | `http://localhost:1420` (development) / `http://localhost:9090` (Compose) |
| API | Fastify/Node.js API, reasoning routes, authentication, WebSockets and service health | `http://localhost:3001` (development) / `http://localhost:3000` (Compose) |
| PostgreSQL | Persistent application data | `localhost:5432` |
| Redis | Cache and runtime coordination | `localhost:6379` |
| MCP HTTP service | Streamable HTTP MCP endpoint and health route | `http://localhost:8765/mcp` and `/health` |
| Workflow package | Separate workflow worker/tooling under `workflows-ryanai/` | Depends on the configured workflow runtime |

The Compose file binds service ports to loopback (`127.0.0.1`) by default. This is intentional: services are not exposed directly to every network interface on the host.

## Requirements

### Required for all installation methods

- Git.
- Node.js **22.12 or newer**.
- npm **10 or newer** (the root project declares npm 10.9.2 as its package manager).
- Network access to download the locked npm dependencies.

### Required for the Docker Compose deployment

- Docker Engine with Docker Compose v2 (`docker compose`).
- Enough disk space and memory to build and run the web, API, MCP, PostgreSQL and Redis containers.
- A local `.env` file containing the required secrets described below.

### Required for local development

- PostgreSQL 16-compatible database with pgvector available where vector features are used.
- Redis 7-compatible service.
- A terminal: PowerShell on Windows, or Bash/Zsh on Linux/macOS.
- Optional: Python tooling, Rust/Cargo, CMake and a C/C++ build toolchain only if you intend to use the Python core, Tauri desktop app, or native inference modules. These are not required for the standard web/API development loop.

### External services (feature-dependent)

- An AI provider API key for the model/provider you intend to call.
- Supabase project URL and public key if Supabase-backed auth/data features are enabled.
- Jarvis endpoint and token only if Jarvis synchronization/patch ingress is intentionally enabled.
- Sentry, Slack, Twilio, or other integration credentials only for the corresponding configured integrations.

## Installation

Clone the repository and enter its root directory:

```bash
git clone https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat.git
cd RYANAI-Automous-Reasioning-Plat
```

Install the root project and the two nested npm packages from their lockfiles:

```bash
npm run install:all
```

This runs `npm ci --legacy-peer-deps` for the root project, `mcp-server/`, and `workflows-ryanai/`. If installation fails, confirm Node/npm versions and that each package has its committed lockfile. Avoid deleting lockfiles as a first troubleshooting step; reproduce the error and resolve the dependency issue deliberately.

For just the root project, use:

```bash
npm ci --legacy-peer-deps
```

## Configuration and environment variables

The application loads local environment configuration from `.env`. Create that file yourself in the repository root; **never commit real credentials**.

### Minimal Docker Compose `.env`

The following is a template, not a set of production credentials. Replace every placeholder with a unique, strong value. Generate secrets with a trusted password manager or a cryptographically secure generator.

```dotenv
# Required by docker-compose.yml — replace with unique secrets
DB_PASSWORD=replace_with_a_strong_postgres_password
REDIS_PASSWORD=replace_with_a_strong_redis_password
JWT_SECRET=replace_with_a_random_secret_at_least_32_characters
MCP_AUTH_TOKEN=replace_with_a_different_random_token_at_least_32_characters

# Optional browser/API configuration
VITE_API_BASE_URL=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SUPABASE_PUBLISHABLE_KEY=

# Optional API integrations
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=

# Optional Jarvis integration — disabled unless explicitly enabled
JARVIS_BASE_URL=
JARVIS_API_TOKEN=
JARVIS_SYNC_ENABLED=false
JARVIS_ALLOW_PRODUCTION_SYNC=false
JARVIS_PATCH_INGRESS_ENABLED=false
JARVIS_INGRESS_TOKEN=
JARVIS_HEALTH_PATH=/health
JARVIS_PATCH_PATH=/api/v1/patches
JARVIS_STACK_PATH=/api/v1/stacks

# Optional MCP model providers
NVIDIA_API_KEY=
NVIDIA_API_ENDPOINT=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=nvidia/nemotron-3-ultra
QWEN_API_KEY=
QWEN_API_ENDPOINT=https://api.together.xyz/v1
QWEN_MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507

# Optional MCP host allowlist; use only trusted hostnames
MCP_ALLOWED_HOSTS=localhost,127.0.0.1,[::1]
```

For example, generate a secret using Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Run the command separately for each secret. Do not reuse the same value for `DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, and `MCP_AUTH_TOKEN`.

### Environment variable reference

| Variable | Required? | Purpose |
| --- | --- | --- |
| `DB_PASSWORD` | Yes for Compose | PostgreSQL password used by the Compose database and API connection string. |
| `REDIS_PASSWORD` | Yes for Compose | Redis authentication password used by Compose and the API connection string. |
| `JWT_SECRET` | Yes for Compose | API token/signing secret. Keep private and rotate if exposed. |
| `MCP_AUTH_TOKEN` | Yes for Compose | Bearer token for MCP HTTP requests; Compose requires it to be at least 32 characters. |
| `DATABASE_URL` | Required for a non-default DB | PostgreSQL connection string. Compose constructs this from `DB_PASSWORD`; local development should point it to your database. |
| `REDIS_URL` | Required for a non-default Redis | Redis connection string, including authentication when enabled. Compose constructs it from `REDIS_PASSWORD`. |
| `NODE_ENV` | Optional | Use `development` for local debug logging and `production` for deployment. |
| `HOST`, `PORT` | Optional | API bind address and port. Defaults to `0.0.0.0:3000` in production and port `3001` in development. |
| `VITE_API_BASE_URL` | Optional locally; deployment-specific | Frontend API origin. Production Vercel builds require a valid HTTPS API origin distinct from the frontend deployment host. |
| `VITE_SUPABASE_URL` | Optional | Supabase URL compiled into the frontend when that integration is used. |
| `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Optional | Public/publishable Supabase key for frontend features; never put a service-role key in a frontend variable. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Optional | Server-side Supabase configuration. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, sensitive | Privileged server-side Supabase key. Keep only in trusted server/deployment secrets. |
| `OPENAI_API_KEY` | Optional, feature-dependent | OpenAI-backed server functionality, when configured. |
| `NVIDIA_API_KEY`, `NVIDIA_API_ENDPOINT`, `NVIDIA_MODEL` | Optional, MCP provider-dependent | NVIDIA model provider credentials, endpoint and model selection. |
| `QWEN_API_KEY`, `QWEN_API_ENDPOINT`, `QWEN_MODEL` | Optional, MCP provider-dependent | Qwen/Together-compatible provider credentials, endpoint and model selection. |
| `MCP_HOST`, `MCP_PORT` | Optional | MCP HTTP bind host and port; defaults to `127.0.0.1:8765` in the standalone service. |
| `MCP_ALLOWED_HOSTS` | Optional | Comma-separated hostnames permitted by the MCP HTTP service. Keep this narrow. |
| `JARVIS_BASE_URL`, `JARVIS_API_TOKEN` | Optional | Jarvis integration endpoint and credentials. |
| `JARVIS_SYNC_ENABLED` | Optional; default false | Enables Jarvis synchronization only when deliberately configured. |
| `JARVIS_ALLOW_PRODUCTION_SYNC` | Optional; default false | Additional production sync guard. Do not enable without review. |
| `JARVIS_PATCH_INGRESS_ENABLED` | Optional; default false | Enables Jarvis patch ingress only when deliberately configured. |
| `JARVIS_INGRESS_TOKEN` | Optional, sensitive | Token protecting patch ingress. |
| `TEST_ADMIN_ACCESS_TOKEN` | Optional for integration tests | Dedicated test access token to exercise authenticated admin WebSocket behavior. If absent, that one test is reported as skipped. |
| `API_BASE_URL`, `WEB_URL`, `WEB_BASE_URL`, `MCP_URL` | Optional for integration tests | Override local endpoints used by the integration test script. |
| `INTEGRATION_TIMEOUT_MS`, `API_TIMEOUT` | Optional for integration tests | Timeout in milliseconds for integration checks. |

Use the environment-variable names in the code and deployment configuration as the source of truth. Some optional integrations require additional provider-specific settings beyond this table; configure only the integrations you actually use.

## Run with Docker Compose (recommended)

Docker Compose is the simplest way to launch the complete local stack.

1. Create the root `.env` file using the template above and replace all four required secrets.
2. Build and start all services:

   ```bash
   docker compose up --build --detach --wait
   ```

   Or use the project script:

   ```bash
   npm run docker:up
   ```

3. Check container status and health:

   ```bash
   docker compose ps
   docker compose logs --tail=200 api web mcp-server postgres redis
   ```

4. Open the web interface at [http://localhost:9090](http://localhost:9090).

### Local service endpoints

- Web UI: `http://localhost:9090`
- API health: `http://localhost:3000/health`
- API root: `http://localhost:3000/`
- MCP health: `http://localhost:8765/health`
- MCP endpoint: `http://localhost:8765/mcp`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

The MCP endpoint is protected by the configured bearer token when `MCP_AUTH_TOKEN` is set. The health endpoint is a health probe, not an authenticated MCP operation.

### Stop and restart

```bash
# Stop containers; retain database/cache volumes
docker compose down

# Restart the stack
docker compose up --detach --wait

# Follow service logs
docker compose logs --follow

# Rebuild images
docker compose build --no-cache
docker compose up --detach --wait
```

**Data warning:** `docker compose down -v` deletes named volumes and permanently removes local PostgreSQL/Redis data. Use it only when you intentionally want a clean reset.

## Run in local development mode

Use this mode when you want hot reload and to work directly on the source. Make sure PostgreSQL and Redis are running and reachable first. Do not start a second copy of the API on a port already occupied by the Compose API.

1. Install dependencies:

   ```bash
   npm run install:all
   ```

2. Create a root `.env` file and set connection strings for your local database and Redis. For example (change the usernames, passwords, database and ports to match your own services):

   ```dotenv
   NODE_ENV=development
   HOST=127.0.0.1
   PORT=3001
   DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/ryanai_db
   REDIS_URL=redis://:PASSWORD@127.0.0.1:6379
   JWT_SECRET=replace_with_a_unique_random_secret
   ```

   If your local Redis has no password, use `REDIS_URL=redis://127.0.0.1:6379`. Set any AI provider or Supabase values required by the features you intend to exercise.

3. Generate Prisma Client and synchronize the schema with your development database:

   ```bash
   npm run db:generate
   npm run db:push
   ```

   `db:push` applies the Prisma schema directly; use it only against a development database unless your team has explicitly approved this deployment procedure. Back up important data before schema changes.

4. Start the API, frontend and MCP HTTP service together:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:1420](http://localhost:1420). The API defaults to `http://localhost:3001` in development, and the MCP HTTP service defaults to `http://127.0.0.1:8765`.

To stop the development processes, press `Ctrl+C`. The `dev` script uses a process supervisor that stops the sibling processes when one exits.

### Start individual components

```bash
npm run dev:web       # Vite frontend
npm run dev:api       # API with TypeScript watch mode
npm run dev:mcp       # MCP HTTP service
npm run start         # Built API server (after build:server)
npm run mcp:start     # MCP stdio transport
npm run mcp:http      # MCP HTTP transport
```

The root `npm run dev` script starts the API, web UI and MCP HTTP service together. Do not run these individual commands at the same time as the combined script unless you have changed the ports.

## Setup and database

### Database initialization

The API requires a reachable PostgreSQL database and Redis instance. The Docker Compose stack creates the PostgreSQL database and initializes the vector-memory SQL file on first volume creation.

For local development, after configuring `DATABASE_URL`:

```bash
npm run db:generate
npm run db:push
```

Available database scripts:

- `npm run db:generate` — generate the Prisma client.
- `npm run db:push` — apply the Prisma schema to the configured database.
- `npm run db:migrate` — invoke the repository's migration runner (currently uses Prisma schema push).

Do not run database setup commands against production without a reviewed backup, migration plan and approval.

### AI provider setup

Configure the credentials for the provider used by the feature you want to run. The MCP provider router currently supports a `nemotron` provider using the NVIDIA-compatible API and a `qwen` provider using the configured Qwen/Together-compatible API. Provider keys are server-side secrets and must not be exposed through `VITE_*` variables.

A missing provider key can cause a reasoning request to fail even while the API health endpoint is healthy. Health status confirms service availability and dependencies, not provider account billing, quotas or model availability.

### Supabase setup

If the deployment uses Supabase-backed features, configure the appropriate project URL and public/anon key for frontend use and server-side settings for backend use. Store `SUPABASE_SERVICE_ROLE_KEY` only in a trusted server environment. Never ship it in a frontend build or expose it in browser code.

### Jarvis integration

Jarvis integration is optional. Keep synchronization and patch-ingress flags disabled until the target endpoint, authentication, allowed operations and environment have been reviewed. Use a dedicated token with the minimum required permissions. Do not enable production sync simply to make a health check pass.

## Operation and useful commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start API, web and MCP HTTP service in development mode. |
| `npm run build` | Type-check and build the frontend bundle. |
| `npm run build:server` | Compile the API/server and copy runtime assets. |
| `npm run validate` | Run repository validation, typecheck, lint, tests, workflow/stack checks and builds. |
| `npm test` / `npm run test` | Run the Vitest suite configured for the repository. |
| `npm run test:e2e` | Run the end-to-end flow script; requires its expected services/configuration. |
| `npm run test:integration` | Run integration checks against the local stack. |
| `npm run startup:verify` | Run startup/service verification checks. |
| `npm run mcp:check` | Check MCP source syntax and dependency policy. |
| `npm run mcp:health` | Check the configured MCP health endpoint. |
| `npm run workflow:validate` | Validate GitHub workflow definitions. |
| `npm run stack:validate` | Validate the stack manifest. |
| `npm run docker:ps` | Show Compose service status. |
| `npm run docker:logs` | Follow Compose logs. |
| `npm run docker:health` | Query the API health endpoint from the API container. |
| `npm run docker:down` | Stop the Compose stack without deleting volumes. |
| `npm run ship` | Run `npm run validate` and then build Docker images. |

Some checks need a running stack, a Docker daemon, valid provider credentials, or optional secrets. Read the failure message to identify whether a check failed due to code, missing configuration, or unavailable infrastructure.

## Health checks and testing

### Quick local smoke test

With the Compose stack running, use these commands:

```bash
docker compose ps
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:9090/health
curl --fail http://127.0.0.1:8765/health
```

The API health response should report `status: "online"` and healthy database/Redis services. The web and MCP health routes return a successful response when their respective processes are reachable.

Run integration checks:

```bash
npm run test:integration
```

The integration script checks database/Redis reachability, API health and dependency status, web health and document response, MCP health, and anonymous WebSocket rejection. The authenticated admin WebSocket check runs only when `TEST_ADMIN_ACCESS_TOKEN` is configured; otherwise it prints an explicit `SKIP`. Configure a dedicated test token in a secure test environment to exercise that path.

### Full validation before a release

```bash
npm run validate
npm run docker:build
docker compose up --detach --wait
docker compose ps
npm run test:integration
```

Then review all required GitHub Actions checks for the exact commit being released. A skipped deployment workflow, skipped authenticated test, or missing external credential must be recorded as such—not described as a successful test of that capability.

## Deployment notes

### Docker

The Compose stack is designed for local or controlled single-host operation. It binds service ports to loopback. If you intend to expose the system remotely, place it behind an appropriately configured HTTPS reverse proxy or managed ingress, restrict database/cache access, and review authentication, CORS, host allowlists, rate limits, backups and monitoring first.

### Vercel frontend

The Vite configuration validates `VITE_API_BASE_URL` for Vercel production builds. Configure it as the **HTTPS origin of the separate API deployment**, not the frontend's own hostname. It must be an origin only (no path, query string, credentials or fragment). Configure public frontend values in Vercel project settings before building.

### API hosting

Configure the API host with a supported Node.js runtime, the required environment variables, a reachable PostgreSQL database and Redis, and a health-check path of `/health`. Keep secrets in the hosting provider's secret manager. Confirm the API deployment and frontend deployment independently, then test the deployed frontend against the deployed API.

### Releases

- Keep dependency lockfiles committed and install with `npm ci`.
- Require CI, security scanning, image builds and integration checks to complete before merging/releasing.
- Verify container image tags/digests and the deployment's commit SHA.
- Run post-deployment smoke tests; do not infer production readiness from a successful container build alone.

## Security guidance

- Never commit `.env`, tokens, passwords, private keys, service-role keys or real user data.
- Use unique, randomly generated secrets per environment and rotate any value that may have been exposed.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, provider API keys, `JWT_SECRET`, `MCP_AUTH_TOKEN` and Jarvis tokens server-side.
- Keep PostgreSQL, Redis, API and MCP ports private unless access is deliberately secured.
- Restrict `MCP_ALLOWED_HOSTS` to trusted hosts. When binding MCP beyond loopback, require a strong token; do not expose an unauthenticated MCP endpoint to the internet.
- Keep Jarvis production sync and patch ingress disabled unless an approved deployment specifically requires them.
- Back up persistent data before database changes and before removing Docker volumes.
- Do not include secrets in logs, screenshots, issue reports or CI output. Use dedicated test credentials rather than production tokens.

## Troubleshooting

### Docker Compose says a required variable is missing

Create the root `.env` file and set `DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET` and `MCP_AUTH_TOKEN`. Ensure the MCP token is at least 32 characters. Restart Compose after changing configuration.

### API health returns 503 or `status: "degraded"`

Inspect the API logs and verify that PostgreSQL and Redis are healthy and reachable with the configured connection strings:

```bash
docker compose ps
docker compose logs --tail=200 postgres redis api
```

### Web UI loads but API requests fail

Confirm the API is healthy at `http://localhost:3000/health` in Compose mode or `http://localhost:3001/health` in local development. Check the frontend API base URL and reverse-proxy configuration. For Vercel production, ensure `VITE_API_BASE_URL` points to the separate HTTPS API origin.

### MCP health is unavailable

Inspect `docker compose logs --tail=200 mcp-server`. Confirm port 8765 is free, the MCP service is running, and the allowed-host configuration matches the request hostname. The health route is `/health`; the MCP protocol endpoint is `/mcp`.

### AI reasoning requests fail but health checks pass

Check the selected provider, API key, endpoint, model name, provider account limits and network connectivity. A healthy API does not guarantee the AI provider is available.

### npm installation or build fails

Confirm versions with:

```bash
node --version
npm --version
```

Use the committed lockfiles and `npm ci --legacy-peer-deps`. Avoid mixing Windows and WSL `node_modules` directories; install dependencies separately in the environment where you run the project. Capture the first actual error rather than only the final summary.

### Port already in use

Stop the existing service or change the relevant port configuration. Do not launch both the full Compose stack and local development services on the same host ports simultaneously.

---

## Support and contribution

1. Reproduce the issue on the latest branch/commit.
2. Include the command, operating system, Node/npm versions and relevant redacted logs.
3. Never attach `.env` files, credentials, tokens or personal data.
4. For code changes, open a pull request with a concise summary, test evidence and any configuration or migration notes.

Repository: https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat
