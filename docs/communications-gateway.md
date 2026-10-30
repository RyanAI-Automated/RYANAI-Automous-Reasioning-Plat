# RyanAI Communications Gateway

The API communications plugin uses real provider APIs. It never fabricates a delivery receipt.

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
- `RYANAI_OWNER_TITLE` (defaults to `Sir`) and optional `TWILIO_VOICE_NAME` (must be a voice supported by your Twilio account)

Owner contact defaults may be configured with `RYANAI_OWNER_PHONE` and `RYANAI_OWNER_EMAIL`; the API does not hard-code personal destinations.

## Twilio Console configuration

Configure the WhatsApp sender's inbound message webhook to `/api/webhooks/twilio/whatsapp` (existing handler). Configure the SMS sender to `/api/webhooks/twilio/sms`. Configure the voice number's incoming-call webhook to `/api/webhooks/twilio/voice`. The voice Gather action must be the exact absolute URL `TWILIO_VOICE_ACTION_URL`. Configure delivery callbacks to `/api/webhooks/twilio/status` and set the exact public callback URL in `TWILIO_STATUS_WEBHOOK_URL`.

Every callback URL must exactly match its configured environment value because Twilio request signatures are validated against that URL. Use HTTPS in production.

## API

Administrator-authenticated `POST /api/comms/send` accepts `{ "channel": "whatsapp|sms|voice|email", "recipient": "...", "message": "...", "subject": "..." }`. A 202 response means the provider accepted the request, not that the recipient received it. Use the provider ID and status callbacks to reconcile delivery.

`GET /api/comms/status` reports configuration presence only, not live connectivity.

## Personalized greetings and South African English

The authenticated UI greets each signed-in user by their chosen title or first name. The owner title defaults to `Sir`; users can select `Sir` or their own name in the welcome panel. Browser speech uses the `en-ZA` locale and offers installed South African English voices where the device provides them. Browsers may block automatic playback until the user presses **Play greeting** once; the preference is retained on that device. Twilio voice `<Say>` and speech recognition use `en-ZA`; `TWILIO_VOICE_NAME` optionally selects a Twilio-supported voice. Inbound WhatsApp, SMS, voice and email replies receive the same owner-address and English (South Africa) instruction.

The browser's selected voice and Twilio's telephony voice are separate provider/device voice inventories; identical sound across devices and calls requires a supported shared TTS provider and its credentials. No custom cloned RyanAI voice or WhatsApp audio-note delivery is claimed by this change.

## Operational safeguards

- Keep Twilio credentials and SMTP credentials in deployment secrets.
- Obtain WhatsApp opt-in and use approved templates where required by WhatsApp policy.
- Outbound calling/SMS must follow consent, local telecommunications rules, quiet hours and opt-out requests.
- Voice conversation uses the configured LangGraph checkpointer/thread persistence; do not describe it as live until provider credentials and the webhook URLs are configured and tested.
- Inbound email, durable unified message history, owner contact enrollment/verification and production provider probes remain follow-up work.
