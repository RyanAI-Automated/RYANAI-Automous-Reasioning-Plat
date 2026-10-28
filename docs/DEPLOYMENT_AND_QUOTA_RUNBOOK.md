# Deployment and Vercel quota runbook

## Deployment source of truth

The GitHub Actions workflow `.github/workflows/vercel-deploy.yml` now performs validation only. It does not load Vercel credentials or publish a deployment.

Production deployment is centralized in `.github/workflows/deploy-vercel.yml`. That workflow runs after **CI - Build, Test, and Integrate** succeeds on `main`/ `master`, and requires the repository Actions variable `VERCEL_DEPLOY_ENABLED=true`. It also needs the `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VITE_API_BASE_URL` configuration.

**Enable only one automatic production deployment source.** If GitHub Actions is the source of truth, turn off automatic Git deployments in the Vercel project's Git settings. If Vercel's Git integration is the source of truth instead, leave `VERCEL_DEPLOY_ENABLED` unset/false and do not enable an additional automatic CLI deploy path. Avoid running multiple production deployers for the same commit.

## Free-tier deployment quota

The observed Vercel check reported the account deployment limit as exceeded (over 100 deployments per day). This is an account quota, not a TypeScript/build error, and repository code cannot raise or reset it.

When that limit is active:
1. Do not repeatedly retry the same deployment.
2. Let the quota reset or upgrade the Vercel plan.
3. Verify only one deployment source is enabled.
4. After CI is green and the quota is available, run one deployment and verify its URL and health.

## Staging integration

Use the manual **Jarvis Staging Bridge Smoke** workflow for RyanAI ↔ Jarvis verification. Configure the four staging secrets described in [the staging runbook](./JARVIS_STAGING_RUNBOOK.md). Do not put tokens in files, command-line arguments, logs, or issue/PR comments. A green build is not proof of a live staging handshake; record the successful smoke run URL after the real endpoints have been tested.

## Pull request previews and token exposure

The GitHub Actions workflow `.github/workflows/preview.yml` now validates the locked install, typecheck and web build without using Vercel deployment credentials or publishing a deployment. If pull-request preview URLs are needed, use Vercel's Git integration as the sole preview deployment source. Do not restore a GitHub Actions preview deploy path with account-scoped tokens in a workflow that executes pull-request code.

The Docker image workflow also separates read-only PR image builds from publishing. Only the trusted publish job receives `packages: write`; manual image publishing is restricted to `main` or `master`.
