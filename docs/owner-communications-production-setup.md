# RyanAI Owner Communications — Production Setup

## Owner destinations

Set `RYANAI_OWNER_PHONE` and `RYANAI_OWNER_EMAIL` only in the API deployment environment. Never commit personal contact data or copy live destination values into repository documentation.

Inbound WhatsApp, SMS, and voice handlers restrict senders to the configured owner phone. Inbound email restricts the sender to the configured owner email address. Email display names are not trusted; the normalized address is compared.

## Twilio configuration

Configure these secret/environment variables on the API service:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` — purchased/verified E.164 voice/SMS-capable number
- `TWILIO_WHATSAPP_NUMBER` — approved WhatsApp-enabled sender; use `whatsapp:+...` or the bare E.164 sender
- `TWILIO_WHATSAPP_CONTENT_SID` — optional approved WhatsApp template Content SID for business-initiated messages outside the 24-hour customer-service window
- `TWILIO_WHATSAPP_WEBHOOK_URL`
- `TWILIO_SMS_WEBHOOK_URL`
- `TWILIO_VOICE_WEBHOOK_URL`
- `TWILIO_VOICE_ACTION_URL`
- `TWILIO_STATUS_WEBHOOK_URL`
- `TWILIO_STATUS_CALLBACK_URL`

Replace `<API_BASE_URL>` with the public HTTPS base URL of the actual API service. Register these exact callback URLs in Twilio; the configured values must match byte-for-byte for signature validation:

| Purpose | URL |
|---|---|
| WhatsApp inbound | `<API_BASE_URL>/api/webhooks/twilio/whatsapp` |
| SMS inbound | `<API_BASE_URL>/api/webhooks/twilio/sms` |
| Voice inbound | `<API_BASE_URL>/api/webhooks/twilio/voice` |
| Voice speech response | `<API_BASE_URL>/api/webhooks/twilio/voice/respond` |
| Delivery/call status | `<API_BASE_URL>/api/webhooks/twilio/status` |

Enable inbound WhatsApp and SMS webhooks on their respective senders. Set the voice number's incoming-call webhook to the voice inbound URL. Set the voice speech Gather action to the exact voice speech response URL. Configure message/call status callbacks to the status URL.

WhatsApp business-initiated messages outside the 24-hour customer-service window require an approved template. Inbound replies and free-form messages are subject to WhatsApp's conversation-window rules. The API supports a Content SID on outbound WhatsApp sends; do not treat a normal text body as a guaranteed out-of-window send.

## Email configuration

Outbound email uses SMTP:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Inbound email uses Resend Receiving:
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`

Register a Resend webhook for the `email.received` event at:
`<API_BASE_URL>/api/webhooks/resend/inbound`

The webhook signature is verified using Resend's SDK and the raw request body. Resend sends metadata first; RyanAI then retrieves the received email body through the Receiving API. Configure a dedicated receiving domain/subdomain or Resend-managed receiving address and route replies there. Do not change the MX records for an existing mail domain/mailbox unless deliberately migrating that mail service. The configured owner email is an authorised sender identity; it is not automatically an inbound Resend mailbox.

## Durable history

The API provisions `communication_conversations` and `communication_messages` in PostgreSQL during startup. Inbound and outbound messages are stored with channel, direction, provider ID, status, metadata, and timestamps. Provider status callbacks update stored status. Keep PostgreSQL backups enabled and retain data according to the operator's privacy policy.

## Verification and activation

`GET /api/comms/status` reports only whether required environment values are present. It does not claim that providers are connected or that messages were delivered.

Before production activation:
1. Confirm the API deployment is reachable and PostgreSQL and Redis readiness checks pass.
2. Verify Resend inbound independently using a signed `email.received` event; confirm the message is retrieved, owner-sender validation succeeds, and the inbound event and reply outcome are persisted.
3. Verify SMTP independently with an explicitly authorised test recipient; confirm provider acceptance and persisted outbound history. A successful SMTP submission is not proof of final inbox delivery.
4. Verify Twilio inbound callbacks and delivery-status callbacks independently, including signature validation and persisted status updates.
5. Only after those checks pass, run one owner-authorised WhatsApp, SMS, and voice test within an explicitly agreed destination and test window. Verify provider callbacks and database history for each test.
6. Verify retry/deduplication behavior and provider failure reporting.

Do not use repeated test calls/messages against a live personal number without the owner's explicit test window. No credentials or real provider sends are included in CI.
