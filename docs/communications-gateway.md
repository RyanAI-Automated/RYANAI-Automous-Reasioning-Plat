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
- Email: SMTP via Nodemailer for outbound messages. Inbound email ingestion is not yet enabled.

## Required environment

Configure these as deployment secrets/environment variables, never commit credentials:

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_NUMBER`
- `TWILIO_WHATSAPP_WEBHOOK_URL`
- `TWILIO_SMS_WEBHOOK_URL`
- `TWILIO_VOICE_WEBHOOK_URL`, `TWILIO_VOICE_ACTION_URL`
- `TWILIO_STATUS_WEBHOOK_URL`, optionally `TWILIO_STATUS_CALLBACK_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

Owner contact defaults may be configured with `RYANAI_OWNER_PHONE` and `RYANAI_OWNER_EMAIL`; the API does not hard-code personal destinations. Set the public frontend build variable `VITE_RYANAI_OWNER_EMAIL` to the same owner email (or set the verified Supabase `app_metadata.owner=true` claim) so the login UI uses the `Sir` salutation without embedding the address in source.

## Twilio Console configuration

Configure the WhatsApp sender's inbound message webhook to `/api/webhooks/twilio/whatsapp` (existing handler). Configure the SMS sender to `/api/webhooks/twilio/sms`. Configure the voice number's incoming-call webhook to `/api/webhooks/twilio/voice`. The voice Gather action must be the exact absolute URL `TWILIO_VOICE_ACTION_URL`. Configure delivery callbacks to `/api/webhooks/twilio/status` and set the exact public callback URL in `TWILIO_STATUS_WEBHOOK_URL`.

Every callback URL must exactly match its configured environment value because Twilio request signatures are validated against that URL. Use HTTPS in production.

## API

Administrator-authenticated `POST /api/comms/send` accepts `{ "channel": "whatsapp|sms|voice|email", "recipient": "...", "message": "...", "subject": "..." }`. A 202 response means the provider accepted the request, not that the recipient received it. Use the provider ID and status callbacks to reconcile delivery.

`GET /api/comms/status` reports configuration presence only, not live connectivity.

## Operational safeguards

- Keep Twilio credentials and SMTP credentials in deployment secrets.
- Obtain WhatsApp opt-in and use approved templates where required by WhatsApp policy.
- Outbound calling/SMS must follow consent, local telecommunications rules, quiet hours and opt-out requests.
- Voice conversation uses the configured LangGraph checkpointer/thread persistence; do not describe it as live until provider credentials and the webhook URLs are configured and tested.
- Inbound email, durable unified message history, owner contact enrollment/verification and production provider probes remain follow-up work.
