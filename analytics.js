// analytics.js
// Twilio dispatch + Segment tracking. Credentials come from the environment:
//   SEGMENT_WRITE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// Nothing is sent on import. Run directly for a manual test:
//   node analytics.js <userId> <recipient E.164>

import { Analytics } from '@segment/analytics-node';
import { pathToFileURL } from 'node:url';

/** Return an environment value, throwing when it is unset or empty. */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const analytics = new Analytics({ writeKey: requireEnv('SEGMENT_WRITE_KEY') });

/** Build the Twilio Basic authorization header; reject missing account credentials. */
const getAuthHeader = () => {
  const credentials = Buffer.from(
    `${requireEnv('TWILIO_ACCOUNT_SID')}:${requireEnv('TWILIO_AUTH_TOKEN')}`
  ).toString('base64');
  return `Basic ${credentials}`;
};

/**
 * Post form parameters to a Twilio account resource and return its response and JSON body.
 * HTTP error statuses are returned unchanged; missing credentials, network failures,
 * and JSON decoding errors reject the promise.
 */
async function dispatch(resource, params) {
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
  return { response, data };
}

/**
 * Send a WhatsApp message and track the event in Segment.
 * `to` and `from` are phone numbers without the `whatsapp:` prefix; `contentSid`
 * identifies the Twilio template. Return the Twilio JSON payload on success.
 * Reject HTTP failures after tracking them; credential, network, JSON decoding,
 * and synchronous tracking errors also propagate.
 */
export async function sendWhatsAppAndTrack({ userId, to, from, contentSid }) {
  const { response, data } = await dispatch('Messages', {
    To: `whatsapp:${to}`,
    From: `whatsapp:${from}`,
    ContentSid: contentSid,
  });

  if (!response.ok) {
    analytics.track({
      userId,
      event: 'WhatsApp Message Failed',
      properties: { to, from, contentSid, errorCode: data.code, errorMessage: data.message },
    });
    throw new Error(`Twilio Error (${data.status}): ${data.message}`);
  }

  analytics.track({
    userId,
    event: 'WhatsApp Message Sent',
    properties: { messageSid: data.sid, to, from, contentSid, channel: 'whatsapp', status: data.status },
  });
  return data;
}

/**
 * Initiate a voice call and track the event in Segment.
 * `twimlUrl` identifies the call instructions. Return the Twilio JSON payload
 * on success; reject HTTP failures after tracking them. Credential, network,
 * JSON decoding, and synchronous tracking errors also propagate.
 */
export async function makeVoiceCallAndTrack({ userId, to, from, twimlUrl }) {
  const { response, data } = await dispatch('Calls', { To: to, From: from, Url: twimlUrl });

  if (!response.ok) {
    analytics.track({
      userId,
      event: 'Voice Call Failed',
      properties: { to, from, twimlUrl, errorCode: data.code, errorMessage: data.message },
    });
    throw new Error(`Twilio Error (${data.status}): ${data.message}`);
  }

  analytics.track({
    userId,
    event: 'Voice Call Initiated',
    properties: { callSid: data.sid, to, from, twimlUrl, channel: 'voice', status: data.status },
  });
  return data;
}

// Manual test run only.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [userId, to] = process.argv.slice(2);
  if (!userId || !to) {
    console.error('Usage: node analytics.js <userId> <recipient E.164 number>');
    process.exit(1);
  }
  try {
    const msg = await sendWhatsAppAndTrack({
      userId,
      to,
      from: requireEnv('TWILIO_WHATSAPP_FROM'),
      contentSid: requireEnv('TWILIO_WHATSAPP_CONTENT_SID'),
    });
    console.log(`WhatsApp sent & tracked: ${msg.sid}`);
  } catch (err) {
    console.error('Execution error:', err.message);
    process.exitCode = 1;
  } finally {
    // Flush buffered Segment events before the process exits.
    await analytics.closeAndFlush();
  }
}