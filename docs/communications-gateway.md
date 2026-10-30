# RyanAI Communications Gateway

The API communications plugin uses real provider APIs. It never fabricates a delivery receipt.

## RyanAI identity and voice

- The configured owner is addressed as **Sir G** (full profile name: Ntsiyeni Ganyane) in login greetings and owner-directed WhatsApp, SMS, voice and email replies; the UI lets each user select a title or their own name. Other signed-in UI users are addressed by their verified display name.
- The UI exposes all 11 South African official languages plus international English variants (UK, US, Australia, Canada, India, Ireland and New Zealand) for response language and voice selection. The owner defaults to English (South Africa) for text and telephony, with Tshivenda (`ve-ZA`) preselected as the preferred browser voice language. Users can change and save their own preferences to Supabase account metadata.
- Browser speech uses only a device voice matching the selected locale; if no matching voice is installed, RyanAI reports that clearly and keeps text available. Tshivenda text generation/translation is model-mediated; wording should be checked for important legal, medical or financial content.
- Twilio voice defaults to `en-ZA` and Amazon Polly `Ayanda-Neural`. `RYANAI_OWNER_LANGUAGE` controls the language requested for owner-facing AI text; `RYANAI_TWILIO_LANGUAGE` controls telephony speech recognition/synthesis locale and must only be changed to a locale supported by the selected Twilio speech providers. `RYANAI_TWILIO_VOICE` selects a compatible voice. Browser Tshivenda voice availability does not guarantee Twilio telephony support.
- Realtime voice instructions request natural South African English; `RYANAI_REALTIME_VOICE` can select a supported Realtime voice. This voice provider has its own voice catalogue and is not guaranteed to sound identical to Twilio's Ayanda voice.

## Channels

- WhatsApp and SMS: Twilio Messaging API.
- Voice: Twilio Programmable Voice with speech Gather callbacks. Inbound calls and outbound calls both enter the RyanAI conversation agent.
- Email: SMTP via Nodemailer for outbound messages. Inbound email ingestion is not yet enabled.

## Required environment

Configure these as deployment secrets/environment variables, never commit credentials:

- `RYANAI_OWNER_TITLE`, `RYANAI_OWNER_NAME`, `RYANAI_OWNER_LANGUAGE`, `RYANAI_TWILIO_LANGUAGE`, `RYANAI_TWILIO_VOICE`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_NUMBER`
- `TWILIO_WHATSAPP_WEBHOOK_URL`
- `TWILIO_SMS_WEBHOOK_URL`
- `TWILIO_VOICE_WEBHOOK_URL`, `TWILIO_VOICE_ACTION_URL`
- `TWILIO_STATUS_WEBHOOK_URL`, optionally `TWILIO_STATUS_CALLBACK_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

Owner identity defaults are `RYANAI_OWNER_TITLE=Sir G`, `RYANAI_OWNER_NAME=Ntsiyeni Ganyane`, and `RYANAI_OWNER_LANGUAGE=en-ZA`; select `ve-ZA` in the UI for Tshivenda text, or set `RYANAI_OWNER_LANGUAGE=ve-ZA` in the server environment for channel-wide owner replies. Owner contact defaults may be configured with `RYANAI_OWNER_PHONE` and `RYANAI_OWNER_EMAIL`; the API does not hard-code personal destinations. The server resolves the owner identity from `RYANAI_OWNER_EMAIL` after verifying the Supabase session and returns only an `isOwner` flag to the authenticated UI. The owner email is never exposed in the frontend bundle.

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
