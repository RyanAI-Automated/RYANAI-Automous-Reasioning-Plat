# Shared environment variable list: Render and Railway (RyanAI API)

**Status:** Proposal for review. Names only. This file holds no values and changes no provider setting.
**Source:** `render.yaml` (`ryanai-api`, 44 variables) and `render.staging.yaml` (`ryanai-api-staging`, 10 variables).
**Topology:** Render is primary. Railway is a backup for the same Docker API (`Dockerfile.api`, `/health`). See `render-primary-railway-backup-deployment-plan.md`.

## Rules

1. **Databases and Redis are per environment.** Railway must never receive the production `DATABASE_URL`, `AUDIOBOOK_DATABASE_URL*` or `REDIS_URL` for staging. Staging gets its own pgvector database so `agent_memory` and `reasoning_cache` stay isolated and intact.
2. **Secrets are entered by the owner.** Take each secret from one password manager and paste it into each dashboard. Do not copy values between providers with a tool or script, and never put them in the repo, logs or a PR.
3. **Non-secret values stay identical** across providers so the API behaves the same on either host.
4. **Staging safety flags stay off:** `SCHEDULER_ENABLED`, `ALERTS_ENABLED`, `COMMUNICATIONS_ENABLED`, `COMMUNICATION_ATTACHMENTS_ENABLED`, `ATTACHMENT_SCANNER_ENABLED`, `ATTACHMENT_ORPHAN_CLEANUP_ENABLED`.
5. **Railway shared variables** (project level) hold only the non-secret shared values. Secrets and database endpoints are set per service.

## Variables

Kind comes from `render.yaml`: `secret` means `sync: false` (set in the dashboard), `value` is a literal in the file, `linked` is resolved from another Render service.

| Variable | Kind | Sharing rule | In Render staging blueprint |
|---|---|---|---|
| `NODE_ENV` | value | Shared value. Keep identical on both providers. | yes |
| `DATABASE_URL` | secret | Per environment. Never share. | yes |
| `REDIS_URL` | linked | Per environment. Never share. | yes |
| `SUPABASE_URL` | value | Shared value. Keep identical on both providers. | no |
| `SUPABASE_SESSION_POOLER_HOST` | secret | Per environment. Never share. | no |
| `AUDIOBOOK_DATABASE_URL` | secret | Per environment. Never share. | no |
| `AUDIOBOOK_DATABASE_URL_UNPOOLED` | secret | Per environment. Never share. | no |
| `SUPABASE_ANON_KEY` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `SUPABASE_PUBLISHABLE_KEY` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `COMMUNICATIONS_ENABLED` | value | Shared value. Keep identical on both providers. | no |
| `COMMUNICATION_ATTACHMENTS_ENABLED` | value | Shared value. Keep identical on both providers. | no |
| `ATTACHMENT_SCANNER_ENABLED` | value | Shared value. Keep identical on both providers. | yes |
| `ATTACHMENT_ORPHAN_CLEANUP_ENABLED` | value | Shared value. Keep identical on both providers. | yes |
| `CLAMAV_HOST` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `CLAMAV_PORT` | value | Shared value. Keep identical on both providers. | no |
| `CLAMAV_TIMEOUT_MS` | value | Shared value. Keep identical on both providers. | no |
| `OPENAI_API_KEY` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `NVIDIA_API_KEY` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `NVIDIA_API_ENDPOINT` | value | Shared value. Keep identical on both providers. | no |
| `NVIDIA_MODEL` | value | Shared value. Keep identical on both providers. | no |
| `QWEN_API_KEY` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `QWEN_API_ENDPOINT` | value | Shared value. Keep identical on both providers. | no |
| `QWEN_MODEL` | value | Shared value. Keep identical on both providers. | no |
| `LOGIC_API_KEY` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `LOGIC_API_ENDPOINT` | value | Shared value. Keep identical on both providers. | no |
| `LOGIC_REASONING_MODEL` | value | Shared value. Keep identical on both providers. | no |
| `RYANAI_GITHUB_TOKEN` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `RYANAI_GITHUB_REPOSITORY` | value | Shared value. Keep identical on both providers. | no |
| `RYANAI_GITHUB_BASE_BRANCH` | value | Shared value. Keep identical on both providers. | no |
| `TWILIO_ACCOUNT_SID` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `TWILIO_AUTH_TOKEN` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `TWILIO_PHONE_NUMBER` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `TWILIO_WHATSAPP_NUMBER` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `RESEND_API_KEY` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `SMTP_HOST` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `SMTP_PORT` | value | Shared value. Keep identical on both providers. | no |
| `SMTP_USER` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `SMTP_PASS` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `SMTP_FROM` | value | Shared value. Keep identical on both providers. | no |
| `RYANAI_OWNER_TITLE` | value | Shared value. Keep identical on both providers. | no |
| `RYANAI_OWNER_LANGUAGE` | value | Shared value. Keep identical on both providers. | no |
| `RYANAI_OWNER_PHONE` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |
| `RYANAI_OWNER_EMAIL` | secret | Same secret from one manager, entered separately in each dashboard. Not in staging unless staging has its own. | no |

## Observations to review

- `render.yaml` defines no `JWT_SECRET` for `ryanai-api`, while `render.staging.yaml` generates one and `.env.example` lists it. Confirm whether production auth depends on it before Railway is configured.
- `.env.example` lists variables that `render.yaml` does not set for the API (for example `CORS_ORIGINS`, `HOST`, `PORT`, `MCP_AUTH_TOKEN`). `render.staging.yaml` sets `CORS_ORIGINS` and `HOST`. Decide which production values are intentionally unset.
- The `redis` URL is linked on Render. Railway needs its own Redis service; do not point it at Render's Key Value instance.

## Out of scope

Writing any value to Render or Railway, changing the staged Railway patch, or deploying.
