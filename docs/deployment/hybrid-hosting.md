# RyanAI hybrid hosting contract

**Status:** configuration and operating contract only. This document does not provision services, inject secrets, migrate data, or deploy anything.

## Service placement

| Layer | Supported host | Contract |
|---|---|---|
| Browser web app | Vercel or Render Static Site | Build the Vite SPA to `dist`; set the public `VITE_API_BASE_URL` to the chosen persistent API's HTTPS origin. |
| Persistent API | Render (primary Blueprint target) or Railway (alternate deployment target) | Run the Fastify server as a long-lived container from `Dockerfile.api`; bind `0.0.0.0` and the platform-provided port; expose `/health`. |
| MCP HTTP | Render Blueprint service or Railway service | Run `mcp-server/Dockerfile`; require a unique `MCP_AUTH_TOKEN` of at least 32 characters and a narrow `MCP_ALLOWED_HOSTS` allowlist. |
| Web proxy container | Docker Compose | Use the `web` target in `Dockerfile`; nginx proxies `/api` and `/ws` to the API service. |
| Database | One authoritative PostgreSQL/pgvector service | Keep PostgreSQL as the durable source of truth. Do not create independent writable production databases on each host. |
| Redis | One coordination/cache service | Use `noeviction`; do not store durable task state only in Redis. |

Do not run multiple writable API stacks against separate databases and present them as one system. If Railway is selected instead of Render for the API, move the API and MCP deployment together and keep the same authoritative PostgreSQL and Redis endpoints. A second provider is a failover/alternate target, not an implicit active-active deployment.

## Vercel

- Root directory: repository root.
- Framework: Vite.
- Install: `npm ci --legacy-peer-deps`.
- Build: `npm run build:web`.
- Output: `dist`.
- Set `VITE_API_BASE_URL` to the selected persistent API's HTTPS origin in Vercel project settings.
- Only browser-public values may use `VITE_*`. Never place provider keys, service-role keys, database URLs, JWT secrets, or MCP tokens in Vite variables.
- The Vercel config includes SPA fallback rewrites. Vercel is used here for the web client, not as a replacement for the persistent Fastify API, MCP listener, or background workers.

## Render

The root `render.yaml` defines static web, Docker API, Redis-compatible Key Value, and an authenticated MCP service in Oregon. Git auto-deploy is intentionally off; CI and an explicit operator action remain the release gates.

Required operator-supplied values are intentionally unresolved in source:
- API: `DATABASE_URL`, Supabase server credentials, model/provider credentials, and any enabled integrations.
- MCP: `MCP_AUTH_TOKEN` (at least 32 characters).
- Redis: provisioned Key Value connection is wired by Blueprint service reference.

The MCP tool allowlist defaults to empty. Enable individual tools only after reviewing their risk and runtime requirements. The API health URL uses Render private networking.

## Railway

Railway is an alternate persistent-container target, not a second independently writable production stack.

For an API service:
1. Connect the official repository and `main` branch in Railway.
2. Set the service Dockerfile path to `Dockerfile.api` (Railway's `RAILWAY_DOCKERFILE_PATH` variable may be used for a non-root Dockerfile path).
3. Configure the healthcheck path as `/health`; ensure the app listens on Railway's injected `PORT`.
4. Supply the same authoritative `DATABASE_URL`, `REDIS_URL`, and required server-side environment values through Railway's Variables UI. Never commit values here.
5. Keep production deploy approval/manual until CI and migration policy are wired and reviewed.

For MCP, create a separate service from `mcp-server/Dockerfile`, set `MCP_HOST=0.0.0.0`, `MCP_PORT=8765`, `MCP_AUTH_TOKEN` (32+ characters), a precise `MCP_ALLOWED_HOSTS`, and the private API health URL. Keep `RYANAI_MCP_ENABLED_TOOLS` empty until individual tools are approved.

Railway's legacy `railway.json` / `railway.toml` Config-as-Code path is deprecated and existing support has a published 2026-12-01 cutoff. This repository therefore does not add a new legacy config file. Use Railway's current Infrastructure-as-Code workflow only after its CLI/SDK and project ownership are explicitly selected.

## Docker and database

- `Dockerfile` remains the canonical multi-target local image: `api`, `web`, and `migrate`.
- `Dockerfile.api` is the standalone API image for Dockerfile-based hosts.
- `mcp-server/Dockerfile` is the standalone MCP image.
- `docker-compose.yml` runs the local Postgres, Redis, migration, API, MCP, and web stack. Postgres migrations are applied by the one-shot `migrate` service before API startup.
- Do not mount legacy `init_vector_memory.sql` into a new Postgres volume; committed Prisma migrations own schema evolution.
- Redis uses `noeviction`; PostgreSQL remains the durable source of truth.
- Do not run a production migration from an API startup command. Use a reviewed, one-shot migration job with the same release commit and database URL.

## Release sequence

1. Validate the Compose file and all Docker builds without publishing images.
2. Validate Prisma schema and migrations against a clean disposable PostgreSQL/pgvector database.
3. Validate API, MCP, and web builds on the exact PR head.
4. Verify provider-specific variables by presence only; never print secret values.
5. Require CI/security success and human approval.
6. Deploy only to the explicitly approved provider/environment, then verify health and commit identity.

No production deployment, database provisioning, migration, secret write, or paid-plan change is authorized by this document.
