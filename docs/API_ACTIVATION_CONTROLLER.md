# RyanAI API Activation Controller

File: `scripts/activate-apis.mjs`

The controller coordinates the local Docker Compose core stack and reports provider/communications configuration without claiming that external services are connected.

## Commands

- `npm run api:preflight` — validate Compose configuration and required core environment values. Read-only.
- `npm run api:start -- --allow-committed-migrations --confirm-database-backup` — build and start PostgreSQL, Redis, API, MCP server and web. **This runs the committed Compose migration dependency.** Back up the target database first; both flags are required.
- `npm run api:verify` — check API/database/Redis health, MCP health, web health, and read `GET /api/comms/status`. It sends no messages or calls.
- `npm run api:report` — print a JSON snapshot of configuration and current runtime checks.

Use `--skip-compose-check` with preflight only when Docker Compose is unavailable; this skips Compose validation and does not make the result a complete preflight.

## Provider and communications semantics

NVIDIA, Qwen, Logic, DeepSeek and TorchTPU keys are reported as `configured_unverified`; missing keys are `missing_credentials`. Supabase and GitHub configuration, plus Jarvis, MCPJungle and Cloudflare opt-in state, are also included in the report. A configured Cloudflare token is reported as not started; this controller never starts the Tunnel. The controller does not make provider API calls. Use the existing manually dispatched **Isolated Provider Verification** workflow for independent NVIDIA, Qwen and Logic brain challenge tests and persisted evidence.

Communications channels are reported from the existing `/api/comms/status` configuration snapshot: Twilio WhatsApp, SMS, voice, SMTP outbound email and Resend inbound email. A configured channel is not authenticated or delivery-tested. The controller never invokes `POST /api/comms/send`, sends email, places calls, sends SMS/WhatsApp, or fabricates delivery evidence.

## Safety boundaries

- Default command is read-only `preflight`; there is no implicit activation.
- `start` requires both explicit migration flags because Compose makes API startup depend on the committed migration service.
- No schema reset, `prisma db push`, database deletion, volume removal, secret rotation or credential output.
- MCPJungle, Cloudflare Tunnel/DNS/Access, hosted deployments and Jarvis production sync remain separate opt-in operations and are not started by this controller.
- No Twilio/SMTP/Resend live tests occur. Those require an explicitly authorised test recipient/window and the documented callback/persistence acceptance checks.
- Never put real credentials in source control or command-line arguments. Keep them in the private `.env` or deployment secret manager.

A successful `start` means Compose completed its start operation. A successful `verify` means the listed local health endpoints passed; neither result proves provider authentication, external webhook registration, message delivery, or production readiness.
