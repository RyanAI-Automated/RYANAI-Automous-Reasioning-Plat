import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { twilioWebhookPlugin } from './twilioWebhook.js';
import { installAuthentication } from './auth.js';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../agent/approvalEngine.js', () => ({
  humanInTheLoopAgent: { invoke },
}));
const applications: FastifyInstance[] = [];
const token = 'synthetic-twilio-auth-token';
const webhookUrl = 'https://app.example.test/api/webhooks/twilio/whatsapp';
const body = { From: 'whatsapp:+15555550123', Body: 'Please help' };

async function sendWebhook(signature?: string, payload = body, host?: string) {
  const app = Fastify();
  applications.push(app);
  installAuthentication(app);
  await app.register(twilioWebhookPlugin);
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/twilio/whatsapp',
    payload: new URLSearchParams(payload).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(signature ? { 'x-twilio-signature': signature } : {}),
      ...(host ? { host } : {}),
    },
  });
}

beforeEach(() => {
  vi.stubEnv('TWILIO_AUTH_TOKEN', token);
  vi.stubEnv('TWILIO_WHATSAPP_WEBHOOK_URL', webhookUrl);
  invoke.mockResolvedValue({
    messages: [{ content: 'Approved <reply> & ready' }],
  });
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('Twilio webhook provider authentication', () => {
  it.each(['TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_WEBHOOK_URL'])(
    'fails closed without %s',
    async (name) => {
      vi.stubEnv(name, '');
      expect((await sendWebhook()).statusCode).toBe(503);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'forged-signature'])(
    'rejects missing or forged signatures (%s)',
    async (signature) => {
      expect((await sendWebhook(signature)).statusCode).toBe(401);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it('rejects tampered signed message content', async () => {
    const signature = twilio.getExpectedTwilioSignature(
      token,
      webhookUrl,
      body,
    );
    expect(
      (
        await sendWebhook(signature, {
          ...body,
          Body: 'Perform different action',
        })
      ).statusCode,
    ).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses the configured external URL rather than a forged Host header', async () => {
    const signature = twilio.getExpectedTwilioSignature(
      token,
      'https://attacker.example/api/webhooks/twilio/whatsapp',
      body,
    );
    expect(
      (await sendWebhook(signature, body, 'attacker.example')).statusCode,
    ).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('accepts an authentic provider request without a user bearer and escapes the reply XML', async () => {
    const signature = twilio.getExpectedTwilioSignature(
      token,
      webhookUrl,
      body,
    );
    const response = await sendWebhook(signature);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/xml');
    expect(response.body).toBe(
      '<Response><Message>Approved &lt;reply&gt; &amp; ready</Message></Response>',
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      { messages: [{ role: 'user', content: 'Please help' }] },
      { configurable: { thread_id: 'whatsapp_15555550123' } },
    );
  });
});
