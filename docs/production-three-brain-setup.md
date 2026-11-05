# Production three-brain provider and deployment setup

This guide separates **runtime provider credentials**, **test-runner credentials**, and **frontend deployment settings**. They belong in different systems.

## 1. Put provider credentials on the API runtime

The three-brain implementation is server-side. `src/agent/providerConfig.ts` resolves the providers independently:

| Brain | Required server-side key | Default provider/model |
| --- | --- | --- |
| Primary | `NVIDIA_API_KEY` | NVIDIA API / `nvidia/nemotron-3-ultra-550b-a55b` |
| Secondary | `QWEN_API_KEY` | Together-compatible Qwen endpoint / `Qwen/Qwen3-235B-A22B-Instruct-2507-tput` |
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

## 3. Use the approved Render and Railway defaults

- **Render** is the default frontend and web/API delivery provider.
- **Railway** is the default Docker and persistent-workload provider.
- The official repository is `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`.

Live Render read-back confirms the existing `ryanai-web` and `ryanai-api` services are connected to the official repository and `main`. The web service is a Static Site; the API uses `Dockerfile.api` and `/health`. Both currently report auto-deploy enabled for commits to `main`, while pull-request preview generation is disabled. The checked-in `render.yaml` currently declares auto-deploy off, so the Blueprint and live dashboard are not aligned. Do not sync the Blueprint or change these production settings without separate approval. Do not merge a change that could trigger a production deployment until the owner explicitly approves that rollout.

The existing Render production services are not staging. A separate `ryanai-staging` service must be created, connected to the official repository, configured with auto-deploy disabled, and verified as isolated before the Render staging workflow can run.

The authenticated Railway account is `ganyane.ntsiyeni@gmail.com`. Its currently visible RyanAI-related project contains only a production environment and a service linked to an unrelated repository that is offline. Do not repoint or redeploy that service. A separate RyanAI staging project, service, and environment linked to the official repository must be created and verified before the Railway staging workflow can run.

## 4. Staging deployment gate

Both provider workflows are manual-only and staging-only. Each requires:
1. An open pull request whose head SHA exactly matches the requested commit.
2. All required CI and security checks completed successfully for that exact SHA.
3. An explicit `STAGE` confirmation.
4. A separately identified staging service/project/environment.
5. A verified isolation confirmation flag after checking databases, storage, networking, and credentials are not shared with production.

The Render workflow verifies that the service name begins with `ryanai-staging`, the official repository is connected, auto-deploy is disabled, and the target service ID is not the production API service. The Railway workflow refuses to use the currently known unrelated Railway project.

No production deployment or database migration is performed by these workflows. Production promotion and migrations require separate approvals.

## 5. Release evidence required

Do not mark the three-brain stack production-ready until all of these are evidenced:
1. The API service is connected to the official repository and a known `main` commit.
2. API health returns HTTP 200 and reports `online`.
3. All three provider credentials are present in the API runtime without exposing their values.
4. The authenticated live probe reports `primary`, `secondary`, and `logic` as `HEALTHY`.
5. The production frontend points to that API and passes its availability check.
6. Database-backed task/handoff recovery is verified against the deployed database and worker, not inferred from source code alone.
