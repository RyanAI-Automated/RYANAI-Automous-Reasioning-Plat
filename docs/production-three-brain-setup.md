# Production three-brain provider and deployment setup

This guide separates **runtime provider credentials**, **test-runner credentials**, and **frontend deployment settings**. They belong in different systems.

## 1. Put provider credentials on the API runtime

The three-brain implementation is server-side. `src/agent/providerConfig.ts` resolves the providers independently:

| Brain | Required server-side key | Default provider/model |
| --- | --- | --- |
| Primary | `NVIDIA_API_KEY` | NVIDIA API / `nvidia/nemotron-3-ultra` |
| Secondary | `QWEN_API_KEY` | Together-compatible Qwen endpoint / `Qwen/Qwen3-235B-A22B-Instruct-2507` |
| Logic | `LOGIC_API_KEY` **or** `OPENAI_API_KEY` | OpenAI-compatible endpoint / `gpt-4o-mini` |

The corresponding endpoint and model overrides are `NVIDIA_API_ENDPOINT`/`NVIDIA_MODEL`, `QWEN_API_ENDPOINT`/`QWEN_MODEL`, and `LOGIC_API_ENDPOINT`/`LOGIC_REASONING_MODEL`. The defaults are documented in `.env.example` and declared as unsynchronized secrets in `render.yaml`.

**Set these keys on the deployed API service**, not in Vite variables and not in the public frontend:
- `NVIDIA_API_KEY`
- `QWEN_API_KEY`
- `LOGIC_API_KEY` (or `OPENAI_API_KEY`)

Use the hosting provider's encrypted environment-variable UI. Never add the values to Git, a Docker build argument, a client-side `VITE_*` variable, issue, or chat. Restart/redeploy the API after setting them so the process loads the new environment.

Vercel is configured as the Vite frontend in this repository. Finding no model-provider keys in the Vercel project is therefore not evidence that the API runtime is missing them; Vercel should not receive these server secrets when the API is hosted separately.

## 2. Put the admin test token on the test runner, not the API

`TEST_ADMIN_ACCESS_TOKEN` is read by `scripts/test-e2e-flow.ts`. It is a **Supabase admin user's access JWT** used by the test runner to authenticate against the API. The probe route itself does not read this environment variable: it uses the normal authenticated request context and requires `request.authUser.role === 'admin'`.

Configure the token as an encrypted GitHub Actions repository or environment secret for the workflow/job that runs the live E2E probe. Also set the non-secret runner variable `RYANAI_LIVE_PROVIDER_TESTS=true`. Do not put this test token in Vercel's frontend environment or expose it to browser code. Do not commit it.

The test runner needs the following:
- `TEST_ADMIN_ACCESS_TOKEN`: admin user's Supabase access JWT, stored as a CI secret.
- `RYANAI_LIVE_PROVIDER_TESTS=true`: enables the real three-brain probe.
- `API_URL` (or `API_BASE_URL`): the deployed API origin.
- `WEB_URL`: the deployed frontend origin for the frontend availability check.

If user-authenticated E2E checks are also required, configure `TEST_USER_ACCESS_TOKEN` as a separate CI secret. The admin token is not a permanent API credential; use a short-lived, least-privileged test identity and rotate it.

The live test calls `POST /api/agent/ops/brains/probe` and requires all three returned brain statuses to be `HEALTHY`. The route is rate-limited to one probe per five minutes and is restricted to authenticated admins. Run it deliberately; each probe makes billable provider calls.

## 3. Correct the Render API service source before deploying

The checked Render service previously associated with this project is not the intended production source: it points to the personal fork `rmnganyane-dev/RYANAI-Automous-Reasioning-Plat`, has auto-deploy disabled, and has no configured health-check path. Do not trigger a deployment from that stale service.

The repository's Render Blueprint defines a dedicated API service using `Dockerfile.api` and `/health`. In the Render dashboard, create or reconnect the API service to:

- Repository: `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`
- Branch: `main`
- Runtime: Docker
- Dockerfile: `Dockerfile.api`
- Health check path: `/health`
- Region: Frankfurt is the configured South Africa-nearby option in the current Blueprint.

Provision the required runtime dependencies before promoting the API: `DATABASE_URL`, `REDIS_URL`, and the server-side Supabase settings used by the selected auth configuration. Add the provider secrets in section 1. Apply the `render.yaml` Blueprint or mirror its non-secret settings in the service dashboard. Verify the service's connected repository and deployed commit before running the live probe.

Do not overwrite an existing service's environment with a partial list. Merge/update only the named variables, preserving database, Redis, Supabase, and other integration settings.

## 4. Vercel deployment gate

The Vercel project serves the Vite frontend; it does not supply the three-brain API runtime. The previously observed Vercel deployment was canceled, with a Hobby build-rate-limit/24-hour retry condition and a Verified Commits warning. The current `main` merge commit was verified by GitHub, so retain Verified Commits and retry after the provider's rate limit resets (or use an eligible plan). Do not disable commit verification or weaken repository protections to force a deployment.

After a successful Vercel deployment, verify the frontend URL and confirm its `VITE_API_BASE_URL` points to the verified API origin. Then verify `GET /health` on the API and run the authenticated three-brain probe.

## 5. Release evidence required

Do not mark the three-brain stack production-ready until all of these are evidenced:
1. The API service is connected to the official repository and a known `main` commit.
2. API health returns HTTP 200 and reports `online`.
3. All three provider credentials are present in the API runtime without exposing their values.
4. The authenticated live probe reports `primary`, `secondary`, and `logic` as `HEALTHY`.
5. The production frontend points to that API and passes its availability check.
6. Database-backed task/handoff recovery is verified against the deployed database and worker, not inferred from source code alone.
