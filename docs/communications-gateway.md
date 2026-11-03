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

Administrator-authenticated `POST /api/comms/send` accepts `{ "channel": "whatsapp|sms|voice|email", "recipient": "...", "message": "...", "subject": "..." }`. A 202 response means the provider accepted the request, not that the recipient received it. Use the provider ID and status callbacks to reconcile delivery.

`GET /api/comms/status` reports configuration presence only, not live connectivity.

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


## Authenticated Comms workspace API

The owner-only workspace uses the same API and durable PostgreSQL communication history as inbound provider webhooks and outbound sends:

- `GET /api/comms/status` returns configuration presence only.
- `GET /api/comms/conversations?limit=50` returns the most recently updated conversations and their latest 30 messages, in chronological order. The limit is clamped to 1–100.
- `POST /api/comms/send` sends through the existing Twilio/SMTP adapters and persists provider acceptance; delivery callbacks reconcile later status.
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
