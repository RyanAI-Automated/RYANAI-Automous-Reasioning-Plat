# Jarvis ↔ RyanAI integration

RyanAI now exposes a configurable bridge for submitting candidate patches and publishing its stack manifest to a Jarvis service. The connector is **off by default**. A patch submission queues a review package in Jarvis; it never edits the RyanAI workspace, merges a GitHub pull request, or deploys a stack.

The repository connection available for this change only exposes the RyanAI repository. The Jarvis-side implementation must accept the REST contract below or adapt the endpoint paths to its existing API.

## REST contract

Configure an HTTP(S) origin for Jarvis. The connector sends a bearer token and JSON:

| Purpose | Default endpoint | Method | Payload schema |
|---|---|---|---|
| Health check | `/health` | GET | Jarvis health response |
| Submit patch for review | `/api/v1/patches` | POST | `ryanai.jarvis.patch/v1` |
| Publish stack metadata | `/api/v1/stacks` | POST | `ryanai.jarvis.stack/v1` |

Override paths with `JARVIS_HEALTH_PATH`, `JARVIS_PATCH_PATH`, and `JARVIS_STACK_PATH` if Jarvis uses different routes. A successful POST should return HTTP 2xx and preferably a JSON response with `id` (or `patchId` / `stackId`) and `status`.

Patch submissions contain a title, safe relative target path, proposed full file content, source branch, base branch, optional GitHub pull-request URL, submitter ID, and timestamp. Stack submissions contain the versioned service manifest from `stacks/ryanai.stack.json`, the environment, branch/commit metadata, and timestamp. Secrets are never included in the stack manifest.

## Environment

Set these on the RyanAI API service and on any host running the CLI:

- `JARVIS_BASE_URL`: Jarvis origin, for example `https://jarvis.example`.
- `JARVIS_API_TOKEN`: server-side bearer token; keep it in a secret store.
- `JARVIS_SYNC_ENABLED=true`: explicit opt-in required before network sync is allowed.
- `JARVIS_HEALTH_PATH`, `JARVIS_PATCH_PATH`, `JARVIS_STACK_PATH`: optional endpoint overrides.
- `JARVIS_ALLOW_PRODUCTION_SYNC=true`: extra opt-in for production stack metadata publication. It is intentionally not enabled in the checked-in configuration.

Keep the token out of `.env.frontend`, Vite variables, manifests, workflow logs, and Git. Local development may use a loopback HTTP endpoint; hosted integrations should use HTTPS.

## API routes

The RyanAI API provides administrator-only routes:

- `GET /api/jarvis/status`
- `POST /api/jarvis/patches`
- `POST /api/jarvis/stacks/publish`

These routes use the existing verified administrator auth guard. If the connector is not configured, status returns a disabled state and writes return HTTP 503 rather than silently pretending to sync.

Jarvis can also submit a reviewed candidate to RyanAI's sandboxed patch engine:

- `POST /api/jarvis/patches/apply` — accepts `filePath`, `patchContent`, and an optional `testScript`.
- Set `JARVIS_PATCH_INGRESS_ENABLED=true` to expose this machine-to-machine route.
- Set `JARVIS_INGRESS_TOKEN` to a dedicated secret and send it as `Authorization: Bearer <token>`. Do **not** reuse `JARVIS_API_TOKEN` for inbound requests.
- This route bypasses the interactive Supabase auth hook only for this exact URL, then validates the separate ingress token with a timing-safe comparison. It returns 404 while disabled, 503 if enabled without a token, and 401 for invalid credentials.
- Accepted candidates go through RyanAI's workspace patch transaction and isolated verification pipeline before promotion. A successful response means the patch was verified and applied to the configured workspace, **not** that a Git commit, pull request, or deployment was created.

Keep ingress disabled unless Jarvis is on a trusted network and the token is stored in the host's secret manager.

## CLI scripts

Run from the RyanAI repository after installing dependencies:

```sh
npm run jarvis:status
npm run jarvis:publish-stack -- staging
npm run jarvis:publish-stack -- production main <commit-sha>
npm run jarvis:submit-patch -- ./patch-proposal.json
```

A patch proposal JSON file has `title`, `targetPath`, `patchContent`, `branch`, and `baseBranch` fields, plus optional `pullRequestUrl` and `requestedBy`.

## MCP connection from Jarvis

For a Jarvis deployment that supports MCP Streamable HTTP, register RyanAI's MCP manager at `/mcp` and use the `MCP_AUTH_TOKEN` as a bearer token. The endpoint host must be listed in `MCP_ALLOWED_HOSTS`; if Jarvis sends an Origin header, that origin host must also be allow-listed. Expose the MCP listener only on a trusted network or behind an authenticated TLS ingress. The MCP manager provides platform health, provider-routed reasoning, project checks, and repository status where Git metadata is present.

## Stack deployment

The manifest describes the services in `docker-compose.yml`, the Kubernetes files under `k8s/`, Render, and the Vercel workflow. It is descriptive metadata; publishing it to Jarvis does not deploy the stack. Production deployment remains subject to the configured CI gates and deployment credentials.