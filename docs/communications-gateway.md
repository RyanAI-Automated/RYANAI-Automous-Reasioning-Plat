# RyanAI Communications Gateway

The API communications plugin uses real provider APIs. It never fabricates a delivery receipt.

## RyanAI identity and voice

- The configured owner is addressed as **Sir** in login greetings and owner-directed WhatsApp, SMS, voice and email replies. Other signed-in UI users are addressed by their verified display name.
- The UI greeting uses the browser's available South African English speech voice (`en-ZA`) and provides a replay control if browser autoplay is blocked.
- Twilio voice uses `en-ZA` speech recognition and the South African English Amazon Polly `Ayanda-Neural` voice by default. Override with `RYANAI_TWILIO_VOICE` only with a Twilio-supported `en-ZA` voice.
- Realtime voice instructions request natural South African English; `RYANAI_REALTIME_VOICE` can select a supported Realtime voice. This voice provider has its own voice catalogue and is not guaranteed to sound identical to Twilio's Ayanda voice.

## Channels

- WhatsApp and SMS: Twilio Messaging API.
- Voice: Twilio Programmable Voice with speech Gather callbacks. Inbound calls and outbound calls both enter the RyanAI conversation agent.
- Email: SMTP via Nodemailer for outbound messages. Resend Receiving handles inbound `email.received` webhooks; the handler verifies the webhook signature, retrieves the received email, validates the configured owner sender, persists the inbound message and attempts an SMTP reply.

These are implemented code paths, not proof that deployment configuration, provider connectivity, callback registration or end-to-end delivery has been verified.

## Required environment

Configure these as deployment secrets/environment variables, never commit credentials:

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_NUMBER`
- `TWILIO_WHATSAPP_WEBHOOK_URL`
- `TWILIO_SMS_WEBHOOK_URL`
- `TWILIO_VOICE_WEBHOOK_URL`, `TWILIO_VOICE_ACTION_URL`
- `TWILIO_STATUS_WEBHOOK_URL`, optionally `TWILIO_STATUS_CALLBACK_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`
- `RYANAI_OWNER_PHONE`, `RYANAI_OWNER_EMAIL` (deployment-only owner identity; never commit personal values)
- `RYANAI_OWNER_TITLE` (defaults to `Sir`) and optional `RYANAI_TWILIO_VOICE` (must be a voice supported by your Twilio account)

The API resolves owner identity from deployment configuration after authentication and returns only an `isOwner` flag to the authenticated UI. Owner contact values must not be exposed in the frontend bundle.

## Twilio Console configuration

Configure the WhatsApp sender's inbound message webhook to `/api/webhooks/twilio/whatsapp`. Configure the SMS sender to `/api/webhooks/twilio/sms`. Configure the voice number's incoming-call webhook to `/api/webhooks/twilio/voice`. The voice Gather action must be the exact absolute URL in `TWILIO_VOICE_ACTION_URL`. Configure delivery callbacks to `/api/webhooks/twilio/status` and set the exact public callback URL in `TWILIO_STATUS_WEBHOOK_URL`.

Every callback URL must exactly match its configured environment value because Twilio request signatures are validated against that URL. Use HTTPS in production.

## API

Owner-authenticated `POST /api/comms/approve` first accepts the exact outbound payload `{ "channel": "whatsapp|sms|voice|email", "recipient": "...", "message": "...", "subject": "...", "idempotencyKey": "client-generated-uuid", "attachmentIds": [] }`. It returns a short-lived (two-minute), owner-bound approval ID whose SHA-256 digest binds the channel, normalized recipient, exact delivery body, subject, WhatsApp template data, idempotency key and attachment IDs. The UI calls this endpoint only from the owner's final review/confirm action. `POST /api/comms/send` must then include that `approvalId`; the server atomically consumes it once and rejects missing, expired, replayed, cross-owner or payload-mismatched approvals before provider dispatch. A direct `/send` request without approval is rejected. The server requires a verified Supabase session and the configured owner identity; administrator role alone is not sufficient for outbound sends. A 202 response means the provider accepted the request, not that the recipient received it. Use the provider ID and status callbacks to reconcile delivery. Each outbound request also requires a client-generated idempotency key. RyanAI persists a `dispatching` record before contacting Twilio or SMTP; a repeated key returns the existing result and never sends again. A transport timeout or persistence failure after dispatch is recorded as `dispatch_unknown` and remains reserved for manual reconciliation rather than risking a duplicate message or call.

`GET /api/comms/status` is available to a verified owner or administrator and reports configuration presence only, not live connectivity. `GET /api/comms/conversations` is owner-only and returns bounded durable history.

## Personalized greetings and South African English

The authenticated UI greets each signed-in user by their chosen title or first name. The owner title defaults to `Sir`; users can select `Sir` or their own name in the welcome panel. Browser speech uses the `en-ZA` locale and offers installed South African English voices where the device provides them. RyanAI chat responses can be read aloud on demand, and new replies are spoken automatically while voice is enabled. Browsers may block automatic playback until the user presses **Play greeting** once; the preference is retained on that device. Twilio voice <Say> and speech recognition use `en-ZA`; `RYANAI_TWILIO_VOICE` optionally selects a Twilio-supported voice. Inbound WhatsApp, SMS, voice and email replies receive the same owner-address and English (South Africa) instruction.

The browser's selected voice and Twilio's telephony voice are separate provider/device voice inventories; identical sound across devices and calls requires a supported shared TTS provider and its credentials. No custom cloned RyanAI voice or WhatsApp audio-note delivery is claimed.

## Operational safeguards

- Keep Twilio credentials, Resend credentials and SMTP credentials in deployment secrets.
- Obtain WhatsApp opt-in and use approved templates where required by WhatsApp policy.
- Outbound calling/SMS must follow consent, local telecommunications rules, quiet hours and opt-out requests.
- Voice conversation uses the configured LangGraph checkpointer/thread persistence; do not describe it as live until provider credentials and webhook URLs are configured and tested.
- Resend inbound and SMTP outbound code paths exist, but provider connectivity, signature validation against live events, successful delivery and durable production history remain unverified until the production checklist passes.

## Multilingual identity and speech

- RyanAI offers selectable preferences for all 11 South African official languages and additional international languages. The selected language is sent with authenticated reasoning requests and becomes an explicit response/translation instruction for the three-brain mission.
- The owner default is `ve-ZA` (Tshivenda); `RYANAI_OWNER_LANGUAGE` can be changed in deployment settings. The owner salutation defaults to `Sir G` via `RYANAI_OWNER_TITLE`.
- Browser speech uses the selected locale and an installed device voice when available. Browser speech voice availability varies by operating system/browser; the UI reports when a matching voice is not installed.
- Twilio currently documents Afrikaans (`af-ZA`) and South African English (`en-ZA`) voices, including Polly Ayanda, but does not list Tshivenda. Therefore phone-call TTS and speech recognition remain on the supported `en-ZA` path unless a future configured speech provider explicitly supports Venda. Text replies and language-aware reasoning can use Tshivenda; do not advertise Venda phone audio as verified until a real provider voice is added and tested.


## Outbound dispatch idempotency

The Comms browser generates a fresh idempotency key for each distinct draft and retains it while a request is unresolved. The API enforces uniqueness in PostgreSQL. Concurrent requests with the same key can produce at most one provider dispatch; reuse for a different recipient or message returns HTTP 409. The outbound row is created before the provider call and is updated with the provider ID/status after acceptance. If the provider request fails ambiguously, the row becomes `dispatch_unknown`; do not blindly retry with a new key until an operator has reconciled the provider result. This deliberately favours preventing duplicate calls/messages over automatic retry of an uncertain delivery.

## Authenticated Comms workspace API

The owner-only workspace uses the same API and durable PostgreSQL communication history as inbound provider webhooks and outbound sends:

- `GET /api/comms/status` returns configuration presence only.
- `GET /api/comms/conversations?limit=50` returns the most recently updated conversations and their latest 30 messages, in chronological order. The limit is clamped to 1–100.
- `POST /api/comms/approve` records the owner's short-lived approval for the exact outbound action.
- `POST /api/comms/send` consumes that approval atomically before calling the existing Twilio/SMTP adapters and persists provider acceptance; delivery callbacks reconcile later status.
- Inbound Twilio and Resend webhooks continue to verify provider signatures and persist inbound events before/while processing them.

All `/api/comms/*` browser requests require a verified Supabase session. History and outbound send additionally require the server-verified owner identity; no owner phone/email is sent to the browser. A provider acceptance response is not a delivery receipt. No live provider calls or messages are part of CI.


## Frontend-to-backend chain

The authenticated frontend route is `/#/comms`. It uses the Supabase session access token through `authenticatedFetch` and calls only the configured RyanAI API origin:

1. `GET /api/comms/status` — channel configuration plus central OpenAI configuration state. This is presence-only and never returns provider credentials.
2. `GET /api/comms/conversations` — owner-scoped history from the shared Prisma/PostgreSQL communication tables.
3. `POST /api/comms/send` — owner-authenticated request into the existing Twilio or SMTP adapter.
4. Provider webhooks — Twilio WhatsApp/SMS/voice/status and Resend inbound email verify signatures, process inbound events, and reconcile provider status into the same history.
5. The Comms screen refreshes the timeline periodically and after a send. It displays provider acceptance separately from confirmed delivery.

The browser never receives `OPENAI_API_KEY`, Twilio credentials, SMTP credentials, Resend credentials, or owner contact configuration. The Comms agent runs server-side through the shared `createChatModel()` configuration; MCP and other server agents use the same API-owned OpenAI key via their authenticated gateway path.


## Intelligent Comms memory and tool boundary

The LangGraph communications agent uses the configured PostgreSQL `DATABASE_URL` through `PostgresSaver`. Startup fails closed when `DATABASE_URL` is missing; it does not silently connect to a local fallback database. Checkpoint schema changes remain part of the explicit database migration workflow, not API startup.

The legacy communications agent and communications sub-agent expose only:
- channel policy lookup;
- bounded, read-only owner conversation context;
- message draft preparation.

They do not have Twilio/SMTP credentials or provider dispatch tools. The main reasoning engine's separate `gatedCommsTools` queue outbound actions into the existing pending-action approval store; queueing is not sending, and an administrator must approve before provider execution.

Cross-channel context is restricted to the configured owner phone/email addresses and reads only bounded recent rows from PostgreSQL communication history. Contact addresses and provider identifiers are omitted from the model context. Because conversation bodies are sensitive, this context tool returns no message content unless both conditions are true:

- `RYANAI_COMMS_MEMORY_LOCAL_ONLY=true`
- `RYANAI_INFERENCE_MODE=local` and `OLLAMA_URL` point to an approved local Ollama endpoint on port `11434` (for example, `http://ollama:11434/v1` inside a Docker network or `http://localhost:11434/v1` when the API shares the host network).
- `OLLAMA_MODEL` names a model that has already been pulled into the local Ollama runtime.

In explicit local mode, `createChatModel()` uses only `OLLAMA_URL` and the non-secret Ollama-compatible placeholder key; it does not read `OPENAI_API_KEY` or fall back to a cloud endpoint. The endpoint is rejected unless it uses HTTP, an approved local hostname, port `11434`, and an optional `/v1` path. Unsupported inference modes fail closed. In cloud mode or when no mode is selected, the existing OpenAI-compatible configuration remains unchanged.

If the endpoint is remote, malformed, or local-only memory is not explicitly enabled, the context tool returns a blocked status without querying PostgreSQL. Do not enable this setting until the local Ollama endpoint is actually running and verified. Configuration is not proof that Ollama or the selected model is installed or healthy; runtime health must be tested separately.

## Private Comms attachments and inbound media

Comms has a separate private bucket, `ryanai-comms-attachments`, and explicit `communication_attachments` metadata. Each object path is bound to the verified owner UUID, Comms conversation and Comms message. A Storage insert trigger verifies these records, enforces 20 MiB/file, 8 files/40 MiB/message, 500 MiB/owner and 100 uploads/hour, and enqueues the existing ClamAV scan. No browser Storage policies are created for this bucket: the owner-authenticated API issues one-use signed upload tokens and only issues short-lived signed read URLs after the scan state is `clean`. The Comms workspace supports multiple file selection and displays scan states; it enables downloads and outbound dispatch only after every file is clean. Attachment reservation, scan transitions, quarantine purges and orphan cleanup are recorded in `communication_attachment_audit`, with metadata and audit tables protected by RLS and no grants for browser roles.

Twilio WhatsApp/SMS media and Resend inbound email attachments are downloaded server-side after signature and owner-sender verification, validated for size/type, and stored in the private bucket. Provider media IDs make partial ingestion retries idempotent; failed Resend media ingestion is marked retryable rather than permanently consuming the webhook claim. Original provider URLs and unscanned bytes are never sent to the reasoning model. Outbound media is added to Twilio messages as short-lived signed URLs and to SMTP as bytes downloaded only after a clean scan. Voice call attachments and arbitrary media with approved WhatsApp templates are not supported.

Inbound attachments require `RYANAI_OWNER_AUTH_USER_ID`, the UUID of the verified Supabase owner account. Webhooks have no user session and will not guess this ID. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are server-only requirements; never expose the service-role key in Vite/browser configuration.

This implements secure media transport and storage, not image understanding, audio transcription, video analysis or document extraction. Those remain gated on the local inference foundation and a separately reviewed scan-clean multimodal processor.

## Python communications orchestration contracts

The optional standard-library package in `comms-orchestration/` defines typed contracts for durable task persistence, atomic claiming, agent execution and task completion/failure. It is an interface layer, not a database adapter or a live worker. The orchestrator persists each task before considering execution, requires an explicit approved flag, checks the task owner against a trusted authenticated owner ID, and permits only `analyse` and `draft` actions. It has no provider dispatch interface. A production adapter must implement idempotent persistence, owner-scoped authorization, atomic claims/leases, bounded retries and audit events before worker activation.

## Communications MCP contracts

Two communications tools are available for explicit operator allowlisting: `comms_policy_read` and `comms_draft_prepare`. They expose channel policy and prepare drafts only; neither reads private history, uses provider credentials, sends messages, schedules messages or places calls. Both require a valid `MCP_AUTH_TOKEN` of at least 32 characters before they can be enabled. The Streamable HTTP transport validates the bearer token using a constant-time comparison. Keep the listener loopback-bound unless a separately reviewed deployment configures a narrow host allowlist and strong token.

The MCP bearer token authenticates the MCP service client, not an individual end user. Do not use these tools for user-specific private history or delegated actions until per-user identity propagation and per-tool authorization scopes are implemented. Stdio transport is trusted local-process access and must be protected by operating-system process permissions. The tools remain disabled unless named in `RYANAI_MCP_ENABLED_TOOLS`.

## Disposable sandbox mode for the LangGraph checkpointer

PostgreSQL remains the default and authoritative checkpointer. The default
`RYANAI_AGENT_MEMORY_MODE=postgres` (or an unset variable) requires
`DATABASE_URL` and fails closed when it is absent.

For isolated, disposable sandbox or test work only, explicitly set
`RYANAI_AGENT_MEMORY_MODE=ephemeral` with `NODE_ENV=staging` or
`NODE_ENV=test`. This selects LangGraph's in-memory `MemorySaver`; its
checkpoints exist only in the process and are lost on exit or restart. The
application refuses this mode when `NODE_ENV=production`, and rejects
unrecognized mode values.

This switch changes only the LangGraph agent checkpointer. It does not replace
PostgreSQL-backed agent task queues, application memory, communications
history, approval records, database health checks, or other durable services.
It therefore does not make the full RyanAI API database-independent. Never
configure the ephemeral mode on a production service or treat it as a
substitute for staging/production PostgreSQL.
