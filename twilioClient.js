// twilioClient.js
// Credentials and phone numbers come from the environment only.
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_FROM, TWILIO_VOICE_FROM, TWILIO_WHATSAPP_CONTENT_SID
// Nothing is sent when this file is imported. Run it directly to send a test:
//   node twilioClient.js +27XXXXXXXXX

import { pathToFileURL } from 'node:url';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const getAuthHeader = () => {
  const credentials = Buffer.from(
    `${requireEnv('TWILIO_ACCOUNT_SID')}:${requireEnv('TWILIO_AUTH_TOKEN')}`
  ).toString('base64');
  return `Basic ${credentials}`;
};

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
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Twilio ${resource} error (${data.status}): ${data.message}`);
  }
  return data;
}

/**
 * Send a Twilio WhatsApp message using a Content Template SID.
 * Supply to/from without the whatsapp: prefix. Nullish from/contentSid values use
 * TWILIO_WHATSAPP_FROM/TWILIO_WHATSAPP_CONTENT_SID; missing defaults throw synchronously.
 * Returns a promise for Twilio's parsed response, rejecting on missing account
 * credentials, transport/JSON errors, or unsuccessful HTTP status.
 */
export function sendWhatsAppMessage({ to, from, contentSid }) {
  return twilioPost('Messages', {
    To: `whatsapp:${to}`,
    From: `whatsapp:${from ?? requireEnv('TWILIO_WHATSAPP_FROM')}`,
    ContentSid: contentSid ?? requireEnv('TWILIO_WHATSAPP_CONTENT_SID'),
  });
}

/**
 * Initiate an outbound voice call with a TwiML URL.
 * A nullish from uses TWILIO_VOICE_FROM; a missing default throws synchronously.
 * Returns a promise for Twilio's parsed response, rejecting on missing account
 * credentials, transport/JSON errors, or unsuccessful HTTP status.
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
    const msg = await sendWhatsAppMessage({ to });
    console.log(`WhatsApp queued. SID: ${msg.sid}`);
  } catch (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  }
}
