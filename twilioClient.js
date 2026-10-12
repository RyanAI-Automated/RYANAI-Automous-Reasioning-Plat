// =====================================================================
// RyanAI Autonomous Reasoning Platform - Twilio Client Utility (v1.1.0)
// Credentials and phone numbers come from the environment only.
// Run directly to test: node twilioClient.js +27XXXXXXXXX
// =====================================================================

import { pathToFileURL } from 'node:url';

/** Read a required environment value or throw when it is missing or empty. */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Build the Twilio Basic authorization header from required environment credentials. */
const getAuthHeader = () => {
  const credentials = Buffer.from(
    `${requireEnv('TWILIO_ACCOUNT_SID')}:${requireEnv('TWILIO_AUTH_TOKEN')}`
  ).toString('base64');
  return `Basic ${credentials}`;
};

/** Post form data to an account-scoped Twilio resource and reject unsuccessful API responses. */
async function twilioPost(resource, params) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${requireEnv('TWILIO_ACCOUNT_SID')}/${resource}.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });

  let data;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text || response.statusText, status: response.status };
  }

  if (!response.ok) {
    throw new Error(`Twilio ${resource} error (${data.code || data.status || response.status}): ${data.message || 'Unknown error'}`);
  }
  return data;
}

/**
 * Send a Twilio WhatsApp message using a Content Template SID.
 * Supports dynamic content variables for personalized agent alerts.
 * Supply to/from without the whatsapp: prefix.
 */
export function sendWhatsAppMessage({ to, from, contentSid, contentVariables }) {
  const payload = {
    To: `whatsapp:${to}`,
    From: `whatsapp:${from ?? requireEnv('TWILIO_WHATSAPP_FROM')}`,
    ContentSid: contentSid ?? requireEnv('TWILIO_WHATSAPP_CONTENT_SID'),
  };

  if (contentVariables) {
    payload.ContentVariables = typeof contentVariables === 'string'
      ? contentVariables
      : JSON.stringify(contentVariables);
  }

  return twilioPost('Messages', payload);
}

/**
 * Initiate an outbound voice call with a TwiML URL.
 */
export function makeVoiceCall({ to, from, twimlUrl }) {
  return twilioPost('Calls', {
    To: to,
    From: from ?? requireEnv('TWILIO_VOICE_FROM'),
    Url: twimlUrl,
  });
}

// Manual test run only: node twilioClient.js <recipient-number>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: node twilioClient.js <recipient E.164 number>');
    process.exit(1);
  }
  try {
    console.log(`==> Sending test WhatsApp message to ${to}...`);
    const msg = await sendWhatsAppMessage({ to });
    console.log(`==> WhatsApp queued successfully. SID: ${msg.sid}`);
  } catch (error) {
    console.error('==> Failed to send WhatsApp:', error.message);
    process.exit(1);
  }
}
