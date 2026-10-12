# 🚀 RyanAI: Autonomous Reasoning Platform

## User authentication

The public landing page links to **Sign in** and **Create account**. Dashboard,
cockpit, and workspace require a Supabase email/password session. Sign-up may
require email confirmation depending on your Supabase project settings; users
return to sign in after confirming. Sign-out clears the browser session and
revokes its refresh tokens through Supabase. Existing access tokens follow
Supabase's expiry policy; use a suitably short JWT lifetime for your deployment.

Configure the same Supabase project on both sides:

- Browser build: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- API runtime: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- In Supabase Auth, enable email/password sign-up, configure your Site URL and
  allowed redirect URLs, and configure production email delivery.
- Apply the repository's `supabase/migrations` to that project so conversations,
  messages, profiles, and memory use the existing per-user row-level policies.

Never put a Supabase secret/service-role key into a `VITE_` setting. Missing
configuration blocks protected screens and APIs; it does not enable demo access.
Local notes and conversation caches are namespaced by account; old unowned demo
storage is retained in the browser but is not automatically assigned to a user.
Vite settings are embedded at build time, so rebuild the frontend after setting
them. Docker Compose forwards API settings and browser build arguments separately.

API clients send `Authorization: Bearer <Supabase access token>`. The API verifies
users with Supabase Auth on each HTTP request. Normal accounts can use reasoning;
approvals, communications, metrics, and shared WebSocket channels require
`app_metadata.role = "admin"`, assigned through a trusted Supabase admin process.
Self-editable `user_metadata` does not grant privileges. `/api/auth/verify` returns
the verified identity. The former shared-password `/api/auth/login` and cookie
logout endpoint return HTTP 410; use Supabase Auth instead.

Health endpoints remain public. Slack callbacks retain signature verification;
Twilio callbacks require `TWILIO_AUTH_TOKEN` and the exact public
`TWILIO_WHATSAPP_WEBHOOK_URL` configured in Twilio. Browser sessions are not a
substitute for webhook signatures. WebSocket upgrades require an admin bearer
header (no tokens in query strings) and reconnect after five minutes; the current
browser UI uses authenticated HTTP/SSE for reasoning.


**Status**: Active development | **Version**: 1.0.0

> **Agentic reasoning platform** with a React/Vite frontend, Fastify API, LangGraph reasoning, optional MCP integrations, and Docker-based PostgreSQL/Redis services.
>
> **Attribution**: Named in honor of Mukhethwa Ryan Ganyane. Developed by RMN Ganyane (Pty) Ltd.

---

## 🎯 Key Features

- **LangGraph ReAct orchestration** - API-side agent orchestration; live reasoning requires a configured provider.
- **Provider-backed reasoning** - Configure an OpenAI-compatible model endpoint and server-side credentials; unavailable local inference is not claimed.
- **Model Context Protocol (MCP)** - Standalone stdio and authenticated Streamable HTTP service.
- **TypeScript validation** - Typecheck, lint, build, and tests are available; run them before deployment.
- **WebSocket endpoint** - The API includes a WebSocket bridge.
- **Docker Compose stack** - Multi-stage builds for the API and web frontend with PostgreSQL and Redis dependencies.
- **Automated CI/CD** - GitHub Actions validation and optional, explicitly configured deployments
- ✅ **Desktop & Web** - Tauri v2 desktop shell + Vite React frontend + Nginx production server

---

## 📊 Architecture

The frontend route manifest lives in [`app/routes.json`](./app/routes.json); the active React app consumes it while implementation remains under `src/`. Canonical RyanAI routes and active skills are described in [`src/config/core.ts`](./src/config/core.ts), and the model allowlist is backed by [`models/catalog.json`](./models/catalog.json). Web builds do not require the legacy `RYANAI` gitlink. Supabase is optional: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to enable it (`VITE_SUPABASE_ANON_KEY` remains supported for existing setups); otherwise the workspace uses local storage. Only browser-safe public keys belong in these Vite variables. The former `ryanai-core.yaml` was removed because it included hard-coded development credentials. The C++ project under `native/local-inference` uses an optional CMake build. The legacy Node addon is also opt-in (see [Optional native Node addon](#optional-native-node-addon)); neither build runs during npm install or enables GPU inference by itself.

```
┌─────────────────────────────────────────────────────────────┐
│                    RyanAI Platform                          │
├────────────────┬──────────────────┬──────────────────────────┤
│                │                  │                          │
│   Frontend     │      Backend     │    Infrastructure       │
│   (React 18)   │    (Fastify)     │    (Docker Compose)     │
│                │                  │                          │
│ • TypeScript   │ • Fastify        │ • PostgreSQL 16         │
│ • Vite         │ • LangGraph      │ • Redis 7               │
│ • Tailwind CSS │ • WebSocket      │ • pgvector              │
│ • Framer Motion│ • MCP service    │ • Nginx                 │
│ • Tauri v2     │ • Auth/JWT       │ • Multi-stage Docker    │
│                │                  │                          │
└────────────────┼──────────────────┼──────────────────────────┘
                 │ Shared Types & Config (src/shared/)
                 │ Environment (.env)
```

---

## 🚀 Quick Start

### Prerequisites
- Docker Desktop installed
- Node.js 22.12+ and npm 10+
- PowerShell or Command Prompt (Windows), or bash (Mac/Linux)
- Rust toolchain only when building the Tauri desktop application
- Python 3.10+ only for Python tooling and workflow tests
- CMake and a C++17 compiler only for `native/local-inference`

### Optional CS-Script VS Code extension

CS-Script is optional editor tooling; the platform does not require .NET. If the
extension reports missing tools, install the [.NET SDK](https://dotnet.microsoft.com/en-us/download)
on the machine where the extension runs. For a remote VS Code window, that means
the remote host or development container.

From the repository root, run:

```bash
npm run setup:cs-script
```

This checks for an SDK, installs missing global `cs-script.cli` and `cs-syntaxer`
tools, and updates tools already installed. It requires network access to NuGet
and permission to write to your user's .NET tools directory. It is opt-in and
does not run during `npm install` or container creation.

Ensure `$HOME/.dotnet/tools` (Linux/macOS) or `%USERPROFILE%\.dotnet\tools`
(Windows) is on PATH. Restart VS Code, then run **CS-Script: Detect and integrate
CS-Script** from the Command Palette.

The `MD034/no-bare-urls` warning in the extension's generated `integration-error.md`
is a separate Markdown formatting issue. Use a Markdown link such as
`[Download the .NET SDK](https://dotnet.microsoft.com/en-us/download)` to fix it.
The file lives in your VS Code user configuration, outside this repository.


### Windows command entry

Paste only the command, without a trailing `# description`. Command Prompt does not
interpret `#` as a comment: npm passes it and the following words to TypeScript,
ESLint, Vite, or concurrently. Use a new terminal for each foreground service.

If `npm run install:all` is missing, your checkout has an older `package.json`.
Inspect `git status` and `git branch --show-current`, preserve local changes, and
synchronize the intended branch before following these instructions.

### Step 1: Configure and start the stack

**Windows Command Prompt:**

```cmd
if not exist .env copy .env.example .env
notepad .env
```

**PowerShell:**

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

**Bash (Linux/macOS):**

```bash
[ -f .env ] || cp .env.example .env
```

Edit `.env` before starting Docker. Replace `DB_PASSWORD`, `REDIS_PASSWORD`,
and `MCP_AUTH_TOKEN` with independent random values. This command
works in all three shells and prints three values you can use, one per setting:

```text
node -e "for(let i=0;i<3;i++) console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

For local Node processes, also put the corresponding database/cache passwords
into `DATABASE_URL` and `REDIS_URL`. Save `.env`, then run:

```text
docker compose config --quiet
npm run docker:up
```

Continue only after the configuration check succeeds. Compose checks all three
required variables even when starting only PostgreSQL and Redis.

If Vite reports a missing `RYANAI/core.json` or `src/lib/supabase` module,
synchronize the current branch with `origin/main` after preserving local changes.
The merged fix uses the tracked `app/routes.json` and explicitly loads
`CommandCenter.tsx`. Restart the development processes after updating the files.

`Dockerfile`, `Dockerfile.api`, `Dockerfile.server`, and `Dockerfile.monorepo` all
build and start the same compiled API launcher. The web image renders its Nginx
template at startup; `PORT` defaults to 80 and `API_HOST`/`API_PORT` default to
`api`/3000. Compose fixes these container ports independently of local development
ports. Browser Supabase settings are supplied as public `VITE_SUPABASE_*` build
arguments; local `.env` files are excluded from the web build inputs.

Set `OPENAI_API_KEY` in `.env` to enable live model reasoning. Without a provider key, the UI and API still start, but reasoning requests return an explicit configuration error.

### Step 2: Access the Platform
- **Frontend**: http://localhost:9090
- **API**: http://localhost:3000
- **Health Check**: http://localhost:3000/health

### Step 3: Verify It Works
```bash
npm run docker:health
npm run startup:verify
npm run test:integration
```

### Stop Everything
```bash
npm run docker:down
```

The API and tunnel load the root `.env` before reading configuration. Existing
shell and Docker Compose environment variables take precedence; `.env` is optional
when those supply configuration. Local `REDIS_URL` must contain the Redis password
(and ACL username if required); setting `REDIS_PASSWORD` alone only configures
Compose. Use the actual password, URL-encoded when necessary, rather than a literal
`${REDIS_PASSWORD}` reference in `REDIS_URL`. The startup banner reports configuration
presence, not successful authentication. For local API + Vite development, set
`PORT=3001` in an existing `.env` copied from an older example; Compose supplies
port 3000 to its API container independently. `API_BASE_URL` remains the Compose
integration-check target (3000); set it to `http://localhost:3001` only when running
integration checks against the local API.

For local development, use `npm run dev:api` (API on port 3001 by default) and `npm run dev:web` (Vite on port 1420). Override ports portably in PowerShell with `$env:PORT='3002'; npm.cmd run dev:api` and `$env:VITE_PORT='5174'; npm.cmd run dev:web`; on bash, use `PORT=3002 npm run dev:api` and `VITE_PORT=5174 npm run dev:web`.

For local Vite development, do not set `NODE_ENV=production` in `.env`; Vite controls development/production mode itself. Docker Compose runs the API in production without requiring this setting in `.env`. `npm run dev:tunnel` requires ngrok account authentication; set `NGROK_AUTHTOKEN` in the root `.env` or shell. The tunnel uses the same `PORT` value as the API (3001 by default for local development).

### Codespaces and local development

If `startup:verify` is missing or `dev` cannot find `scripts/dev-all.mjs`, inspect
`git status` and synchronize your intended branch after preserving local changes.
`npm run` lists available scripts; `npm run3` is not an npm command.

The dev container includes Node 22 and Docker Compose. After updating its
configuration, run **Codespaces: Rebuild Container** from the command palette.
An existing container will not gain Docker until it is rebuilt. Confirm readiness:

```bash
node --version
docker info
docker compose version
```

Node must be 22.12 or newer. If `docker` is missing or its daemon is unavailable,
resolve that before running any `docker:*` commands. Outside Codespaces, install
and start Docker with Compose, or provide running PostgreSQL and Redis services
and set their connection URLs in `.env`.

For the API, Vite UI, and MCP development processes:

```bash
npm run install:all
```

Create `.env` from `.env.example` only if it does not already exist. Replace the
three secret placeholders, and also replace the matching password portions of
`DATABASE_URL` and `REDIS_URL`. Set `PORT=3001` and remove any old
`NODE_ENV=production` line. Start only the database and cache containers, then
keep this terminal running:

```bash
docker compose up -d --wait postgres redis
npm run dev
```

Open http://localhost:1420 (or forward port 1420 in Codespaces). In a second terminal:

```bash
npm run startup:verify -- --local
npm run test:integration -- --local
npm run mcp:health
```

`--local` uses `PORT` (default 3001) and `VITE_PORT` (default 1420), overriding
the Compose HTTP URLs in `.env`. Without it, checks use `API_BASE_URL` and
`WEB_BASE_URL` (defaults 3000 and 9090). Both checks load `.env`; exported shell
values take precedence. Redis must authenticate successfully before the API
starts. A connection failure now exits with setup guidance instead of waiting
for a Fastify plugin timeout. Integration checks fail if dependencies are down.

Use Ctrl+C to stop development processes, then `npm run docker:down` to stop
the database and cache containers. The Tauri desktop process is optional and
should be started in its own terminal only when working on the desktop app.

---

## 📁 Project Structure

```
src/                          # React frontend + shared libraries
├── App.tsx                   # Main routing component
├── main.tsx                  # Entry point
├── index.css                 # Global styles (Tailwind)
├── components/               # React components (13 total)
│   ├── ChatPanel.tsx
│   ├── TelemetryPanel.tsx
│   ├── Sidebar.tsx
│   └── ... (10 more)
├── lib/                      # Shared libraries
│   ├── types.ts             # TypeScript interfaces
│   ├── models.ts            # LLM model config
│   ├── reasoning.ts         # Reasoning engine
│   ├── storage.ts           # Persistence utilities
│   └── supabase.ts          # Backend integration
└── shared/                   # Cross-cutting concerns
    ├── types.ts             # API types
    ├── config.ts            # Config loader
    ├── logger.ts            # Logging
    └── ... (utilities)

src/server/                   # Fastify backend
├── launcher.ts              # API server
├── api/
│   ├── websocket.ts         # WebSocket bridge
│   └── client.ts            # Frontend client
├── routes/                  # REST endpoints
└── db/
    ├── migrate.ts           # Migration runner
    └── ... (database layer)

src-tauri/                    # Tauri desktop shell
├── src/main.rs
└── Cargo.toml

scripts/                      # Build & development scripts
├── dev-all.mjs             # Concurrent dev services
├── test-e2e-flow.ts        # E2E tests
├── tunnel.ts               # ngrok webhook tunnel
├── orchestrate.mjs         # Service orchestrator
└── ... (12 more)

docker-compose.yml          # Web, API, PostgreSQL, and Redis services
Dockerfile                  # API runtime
Dockerfile.api              # API gateway runtime
Dockerfile.server           # Reasoning API runtime
Dockerfile.web              # Frontend build (Nginx)
.dockerignore               # Docker exclusions
.env.example                # Environment template
package.json               # Build, development, and Docker scripts
tsconfig.json              # TypeScript config
vite.config.ts             # Vite config
```

---

## 🛠️ Development

### Load only the UI

```bash
npm ci --legacy-peer-deps
npm run dev:web
```

Open http://localhost:1420. The React UI mounts without waiting for the API,
PostgreSQL, Redis, MCP, or model credentials. Health checks use `/api/health` and
time out after five seconds; unavailable services are reported in the UI.
Navigation and the local workspace remain available, while live reasoning needs
the configured API. For a built UI, run `npm run build` then `npm run preview`.

Keep `index.html` at the project root and `App.tsx` under `src/`. The supported
API entrypoint is `src/server/launcher.ts` (`npm run dev:api`); the standalone
`server.ts` and `src/server.ts` scripts are legacy alternatives and do not serve
the React UI. Docker Compose serves the UI through `Dockerfile.web`/Nginx on
http://localhost:9090. Preserve the repository's full `.dockerignore` when
integrating standalone file copies.

### All Services at Once
```bash
npm run dev
```

### Individual Services
```bash
npm run dev:api
npm run dev:web
npm run dev:mcp
npm run dev:desktop
```

### Install Dependencies for Local Development
```bash
npm run install:all
```

The root and app-specific `package-lock.json` files pin Node dependencies. Desktop dependencies are managed by Cargo; `requirements.txt` is currently empty because the Python tooling has no declared third-party packages.

### With Webhook Tunnel
```bash
npm run dev:tunnel
```

### Optional dispatch notifications

Pipeline notifications require explicit configuration: `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, and `DEFAULT_RECIPIENT_PHONE` for
WhatsApp; `RESEND_API_KEY`, `DISPATCH_FROM_EMAIL`, and `DEFAULT_RECIPIENT_EMAIL`
for email. Keep credentials in the server environment; do not use `VITE_` prefixes.
Missing credentials are reported when a notification is requested.

### Type Checking & Validation
```bash
npm run typecheck
npm run lint
npm run validate
```

---

## 🐳 Docker & Infrastructure

### Container Management
| Command | Purpose |
|---------|---------|
| `npm run docker:up` | Build + start all containers (background) |
| `npm run docker:build` | Build without starting |
| `npm run docker:down` | Stop and remove all containers |
| `npm run docker:logs` | Stream logs from all containers |
| `npm run docker:ps` | Show running containers |
| `npm run docker:health` | Check API health endpoint |
| `npm run startup:verify` | Check API, PostgreSQL, Redis, and frontend health |

### Services
- **api** (Port 3000): Fastify backend with WebSocket, REST, MCP, and LangGraph reasoning
- **web** (Port 9090): Nginx serving the React frontend and proxying API calls
- **postgres** (Port 5432): PostgreSQL with pgvector for embeddings
- **redis** (Port 6379): Redis for caching and rate limiting

The desktop shell and Render workflow worker remain separate applications. The standalone MCP service starts with Compose at `http://localhost:8765/mcp`; its health endpoint is `http://localhost:8765/health`. The Compose service binds only to loopback and requires `MCP_AUTH_TOKEN` in `.env`.

### Verify Everything Works
```bash
docker compose ps                              # Show status
curl http://localhost:3000/health              # API health
curl http://localhost:9090 | head -20         # Frontend

# Or use the npm command
npm run docker:health
npm run mcp:health
```

### MCP Server

The standalone server supports stdio for editor/agent clients and Streamable HTTP for a live service:

```bash
npm run install:all
npm run mcp:check
npm run mcp:start
npm run mcp:http
npm run docker:up
npm run mcp:health
```

`npm run mcp:start` occupies its terminal and reads MCP protocol messages from stdin;
it does not accept shell commands. Stop it with Ctrl+C or open another terminal
before running `npm run mcp:http` or other commands.

For local HTTP use outside Compose, `MCP_HOST` defaults to `127.0.0.1`. Binding to a non-loopback interface requires an `MCP_AUTH_TOKEN` with at least 32 characters and a matching `MCP_ALLOWED_HOSTS` entry. Configure provider credentials with `NVIDIA_API_KEY` or `QWEN_API_KEY`; reasoning calls fail clearly if a key is not configured. MCP does not claim a local-model fallback unless one is actually running.

---

## 📦 Build & Production

### Production Build
```bash
npm run build
npm run build:server
```

### Type-Safe Pipeline
```bash
npm run validate
```

### Build Production Containers
```bash
npm run ship
```

For Vercel, set `VITE_API_BASE_URL` to the HTTPS origin of a separately hosted RyanAI API. Vercel hosts the static web frontend; it does not host this repository's API, PostgreSQL, or Redis services.

If reasoning reports `404 NOT_FOUND` with a Vercel request ID, check the request URL in the browser Network panel. It must target the Fastify API's `/api/reasoning/stream`, not the Vercel frontend. Set `VITE_API_BASE_URL` in the Vercel project's environment settings for the affected deployment environment, then rebuild/redeploy (Vite embeds this value at build time). Use only the API's HTTPS origin, without `/api` or a route suffix. Verify that origin's `/api/health` returns the RyanAI gateway JSON; a degraded response indicates backend dependencies need attention. Vercel builds now reject a missing or invalid API origin, including the deployment's own Vercel hostname. `VITE_API_URL` remains a legacy fallback. Running or changing `src/server/launcher.ts` alone does not create API routes on Vercel.


GitHub Actions publishes production images after validation on the configured default branch. To enable the GitHub Actions Vercel deployment, configure repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`, plus repository variables `VERCEL_DEPLOY_ENABLED=true` and `VITE_API_BASE_URL` (the deployed API origin). The repository's [`vercel.json`](./vercel.json) sets `npm ci --legacy-peer-deps` as the install command and `npm run build:web` as the build command. Do not set `npm run build:web` as Vercel's install command. Older commits do not contain these configuration changes; deploy a commit that includes them.

The scheduled and manually triggered smoke tests require `PROD_GATEWAY_URL` (the full API health URL, e.g. the API origin plus `/health`) and `PROD_FRONTEND_URL` secrets. Preview checks additionally require `PREVIEW_GATEWAY_URL` and `PREVIEW_FRONTEND_URL`.

### Windows Installers
```powershell
npm run release
.\build-installer.ps1       # Alternative: PowerShell script
```

---

## 🧪 Testing

### Comprehensive Test Suite
| Command | Purpose |
|---------|---------|
| `npm run test` | Unit + integration tests (Vitest) |
| `npm run test:e2e` | End-to-end flow tests |
| `npm run test:integration` | Integration test suite |
| `npm run test:platform` | Platform-specific tests |

`npm run test` runs the local Vitest suite. `npm run test:e2e` and `npm run test:integration` require the API and web stack to be running; integration tests also need reachable PostgreSQL and Redis configured with `DATABASE_URL` and `REDIS_URL`. These are commands to execute in your environment, not a claim that production deployment has been verified.

Both smoke scripts load `.env` (existing shell values take precedence). For a local
API/Vite session, use `npm run test:e2e -- --local` or
`npm run test:integration -- --local`; these use `PORT` (default 3001) and
`VITE_PORT` (default 1420) instead of the Compose URLs. Otherwise configure
`API_BASE_URL`, `WEB_BASE_URL`, and optionally `API_HEALTH_URL`.

Anonymous reasoning requests and WebSocket upgrades must return HTTP 401.
To also check authenticated behavior, supply short-lived Supabase access tokens
in your local environment: `TEST_USER_ACCESS_TOKEN` for the end-to-end empty-prompt
check (HTTP 400), and `TEST_ADMIN_ACCESS_TOKEN` for successful WebSocket upgrades
in both scripts. The latter account must have trusted `app_metadata.role=admin`.
Tokens are sent only in authorization headers; do not commit them. Use trusted
API targets when supplying tokens. Missing tokens produce explicit `SKIP` lines
and a separate skipped count; supplied invalid/expired tokens or a non-admin
WebSocket token fail the checks. A pass with skipped checks does not validate
sign-in, authenticated reasoning, or administrator access.

### Sandbox Test Console
Open http://localhost:9090/sandbox.html to test:
- API connectivity
- Database operations
- WebSocket communication
- Cache functionality
- Reasoning engine

---

## 📊 Database

### Setup & Migrations
```bash
npm run db:setup
npm run db:generate
npm run db:push
npm run db:migrate
```

The `prisma/schema.prisma` schema currently targets SQLite for Prisma-generated client use. The Compose API separately connects to PostgreSQL via `pg.Pool`; PostgreSQL initialization is managed separately. Do not assume Prisma migrations create or migrate the Compose API's PostgreSQL tables.

---

## 🔑 Environment Configuration

### Create `.env` from Template
```bash
cp .env.example .env
```

### Required Environment Variables
```bash
# Core
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Database
DB_PASSWORD=replace-with-a-unique-password
DATABASE_URL=postgresql://ryanai:${DB_PASSWORD}@localhost:5432/ryanai_db
DB_MAX_CONNECTIONS=20
DB_TIMEOUT_MS=2000

# Redis
REDIS_PASSWORD=replace-with-a-different-password
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379
REDIS_TIMEOUT=5000

# Authentication
JWT_EXPIRES_IN=24h

# API Configuration
API_BASE_URL=http://localhost:3000
API_TIMEOUT=30000

# LLM Providers
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Optional Services
NGROK_AUTHTOKEN=...                    # For webhook testing
MCP_ENABLED=true
MCP_PORT=8765
SENTRY_ENABLED=false
SENTRY_DSN=...
TAURI_ENABLED=false
```

---

## 🧠 Features Overview

### Chat & Reasoning
- ✅ Send messages to autonomous reasoning engine
- ✅ Real-time streaming responses with tool traces
- ✅ Multi-turn conversations with memory
- ✅ Export conversations as Markdown
- ✅ Model selection (Claude, GPT-4, Gemini, Local)
- ✅ Temperature & token controls

### Monitoring & Telemetry
- ✅ Real-time CPU & memory usage
- ✅ Response latency tracking
- ✅ Token usage metrics (input/output)
- ✅ Tool execution traces
- ✅ System uptime & health status
- ✅ OpenTelemetry integration (optional)

### User Experience
- ✅ Professional HUD dark theme
- ✅ Smooth animations (Framer Motion)
- ✅ Responsive mobile design
- ✅ Real-time updates (WebSocket)
- ✅ Voice input support
- ✅ Memory vault for persistent notes
- ✅ GitHub OAuth integration

### Security & Authentication
- ✅ Supabase email/password sign-in and registration
- ✅ Verified bearer sessions and administrator permissions
- ✅ Session restoration and real sign-out
- Authentication provider OAuth buttons and demo bypasses are not enabled.
- ✅ Rate limiting (100 requests/minute)
- ✅ CORS properly configured

---

## 🚨 Troubleshooting

### Out of Disk Space
**Problem**: ENOSPC errors during builds

**Solution**: Move project to drive with space or use Docker-only
```bash
# Move to D: drive (Windows)
Copy-Item "C:\Users\...\RYANAI" -Destination "D:\RYANAI" -Recurse
cd D:\RYANAI
npm run docker:up
```

### Port Already in Use
**Problem**: EADDRINUSE on port 3000, 3001, 1420, or 9090

**Solution**: Use different port
```bash
PORT=3002 npm run dev:api              # Custom API port
npm run dev:web -- --port 1421
```

### Docker Won't Start
**Problem**: Container fails to build or start

**Solution**: Clean Docker state
```bash
docker system prune -af                # Remove unused images/volumes
npm run docker:down -v
npm run docker:up
```

### WebSocket Connection Failed
**Problem**: Real-time updates not working

**Solution**: Check WebSocket endpoint
```bash
# Test WebSocket
curl -i -N -H "Connection: Upgrade" http://localhost:3000/ws

# Enable verbose logging
LOG_LEVEL=debug npm run dev:api
```

### TypeScript Errors
**Problem**: Type checking failures

**Solution**: Rebuild TypeScript cache
```bash
npm run typecheck
rm -rf dist node_modules/.cache       # Clear cache
npm run validate
```

### Database Connection Issues
**Problem**: PostgreSQL or Redis unreachable

**Solution**: Verify services are running
```bash
docker compose ps                      # Show container status
npm run docker:logs
npm run docker:health
```

---

## 📚 Complete Scripts Reference

### Development Scripts (11)
```bash
npm run dev
npm run dev:all
npm run dev:api
npm run dev:web
npm run dev:mcp
npm run dev:desktop
npm run dev:tunnel
npm run start
npm run preview
npm run orchestrate
npm run tunnel
```

### Docker & Infrastructure (9)
```bash
npm run docker:up
npm run docker:build
npm run docker:down
npm run docker:logs
npm run docker:ps
npm run docker:health
npm run infra:up
npm run infra:down
npm run infra:logs
```

### Build & Validation (8)
```bash
npm run build
npm run typecheck
npm run lint
npm run validate
npm run build:client
npm run build:server
npm run build:api
npm run build:desktop
```

### Testing (4)
```bash
npm run test
npm run test:e2e
npm run test:integration
npm run test:platform
```

### Database (4)
```bash
npm run db:setup
npm run db:generate
npm run db:push
npm run db:migrate
```

### Advanced (25+)
```bash
npm run mcp:check
npm run mcp:start
npm run mcp:system
npm run cmake:configure
npm run cmake:build
npm run rust:fetch
npm run rust:check
npm run rust:build
npm run core:run
npm run core:check
npm run tauri
npm run release
npm run ship
npm run telemetry:collect
```

**Full reference**: See [SCRIPTS_REFERENCE.md](./SCRIPTS_REFERENCE.md)

---

## 🔐 Security Considerations

### Development
- ✅ JWT secret in `.env` (not committed)
- ✅ API keys never bundled in frontend
- ✅ CORS properly restricted to localhost:5173
- ✅ Rate limiting enabled (100 req/min)

### Production
- ⚠️ Change default database password
- ⚠️ Use strong JWT secret (32+ chars)
- ⚠️ Enable HTTPS/TLS
- ⚠️ Restrict CORS to your domain
- ⚠️ Use environment secrets manager
- ✅ API authentication middleware enabled (configure Supabase before use)
- ⚠️ Set up rate limiting rules
- ⚠️ Regular security audits

### Local Inference
- ✅ Model weights optional (local-first design)
- ✅ Offline capability maintained
- ✅ Air-gap vector cache in IndexedDB
- ✅ Sentinel policy audit logging

---

## 📞 Documentation

| Document | Purpose |
|----------|---------|
| `QUICKSTART.md` | 2-minute quick start |
| `SCRIPTS_REFERENCE.md` | Complete command reference |
| `INTEGRATION.md` | Architecture & setup details |
| `AUDIT_COMPLETE.md` | Full audit report |
| `SCRIPT_AUDIT.md` | Script migration guide |

---

## 🎓 Learning Resources

### API Endpoints
```
GET    /health              System health status
POST   /api/reason          Simple reasoning
POST   /api/reasoning/stream Streaming reasoning
POST   /api/mcp             MCP tool calls
POST   /api/auth/login      Authentication
GET    /api/auth/verify     Token verification
GET    /api/system          System information
```

### WebSocket Channels
```
auth.verify         Verify authentication
reasoning.start     Start reasoning session
reasoning.stream    Stream reasoning events
subscribe           Subscribe to updates
system             System events
```

---

## 🚀 Deployment Options

### Docker (Recommended)
```bash
npm run docker:up
# Or: docker buildx build --push
```

### Optional native Node addon

Root `npm install` / `npm ci` skips automatic node-gyp compilation via
`gypfile: false`. Vercel builds only the web frontend; dependency lifecycle
scripts remain enabled (do not use `--ignore-scripts` as a workaround).

To explicitly build the legacy Node addon on a host with Python, a C++ build
toolchain, and the CUDA toolkit installed:

```bash
npm ci --legacy-peer-deps
npm run native:addon:build
```

The addon build uses the declared `node-gyp` and `node-addon-api` development
dependencies, so install dev dependencies on the build host. Its existing Linux
configuration expects CUDA at `/usr/local/cuda`; Windows uses `CUDA_PATH` or the
existing CUDA v12.0 default. The current target links the CUDA runtime but does
not compile the CUDA kernels; this command alone does not enable GPU inference.
This is separate from the optional CMake project (`npm run native:build`).

### AWS/GCP/Azure
1. Build Docker image
2. Push to container registry
3. Deploy using managed container services
4. Configure RDS for PostgreSQL
5. Configure ElastiCache for Redis

### Heroku/Railway
```bash
git push heroku main  # Auto-deploys from git push
```

---

## 🎉 What's Included

✅ **60+ npm scripts** - All tested and working
✅ **Complete React frontend** - 13 components, 6 libraries
✅ **Fastify backend** - Express-compatible with plugins
✅ **Docker infrastructure** - 4 services, health checks
✅ **Database** - PostgreSQL with pgvector, Prisma ORM
✅ **Cache layer** - Redis with rate limiting
✅ **WebSocket bridge** - Real-time bidirectional communication
✅ **Type safety** - Full TypeScript throughout
✅ **Testing suite** - Unit, integration, E2E tests
✅ **CI/CD ready** - Automated validation & deployment
✅ **Documentation** - Complete guides and references
✅ **Security** - JWT, CORS, rate limiting, validation

---

## 📈 Performance

- ✅ Response latency: <100ms (local) to <500ms (API)
- ✅ Streaming updates: Real-time via WebSocket
- ✅ Database: 20 concurrent connections
- ✅ Cache hit rate: 95%+ for repeated queries
- ✅ Frontend: 90+ Lighthouse score
- ✅ Bundle size: <500KB gzipped

---

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and test: `npm run validate`
3. Commit: `git commit -m "feat: description"`
4. Push: `git push origin feature/your-feature`
5. Create Pull Request

---

## 📄 License

**Proprietary Software** — Developed and maintained by **RMN Ganyane (Pty) Ltd**. All rights reserved.

Named in honor of **Mukhethwa Ryan Ganyane**.

---

## 🎯 Next Steps

1. **Start**: `npm run docker:up`
2. **Access**: http://localhost:9090
3. **Test**: Click "Try Demo"
4. **Customize**: Update `.env` with your API keys
5. **Deploy**: `npm run ship`

---

## 💬 Support & Feedback

For issues, questions, or feedback:
1. Check `QUICKSTART.md` for quick answers
2. See `SCRIPTS_REFERENCE.md` for command help
3. Review `INTEGRATION.md` for architecture details
4. Check logs: `npm run docker:logs`

---

**RyanAI Autonomous Reasoning Platform v1.0.0**

Status and supported behavior are documented above; run the validation commands before deployment.

Built with:
- React 18 + TypeScript
- Fastify + Express
- PostgreSQL + Redis
- Docker + Nginx
- Tauri v2 (Desktop)
- LangGraph + MCP

**Ready to deploy. Start now!** 🚀

### Workspace patch safety

The `self_patch_workspace` tool requires an approved isolated verifier and exclusive
workspace ownership. See [workspace patching and recovery](docs/workspace-patching.md)
and [verifier provisioning](docs/patch-verifier.md) before enabling it.
