import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { twilioWebhookPlugin } from './twilioWebhook.js';
import { installAuthentication } from './auth.js';

const { invoke, prismaMock } = vi.hoisted(() => ({
  invoke: vi.fn(),
  prismaMock: {
    communicationConversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }) },
    communicationMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));
vi.mock('../../agent/approvalEngine.js', () => ({
  humanInTheLoopAgent: { invoke },
}));
const applications: FastifyInstance[] = [];
const token = 'synthetic-twilio-auth-token';
const webhookUrl = 'https://app.example.test/api/webhooks/twilio/whatsapp';
const body = { From: 'whatsapp:+15555550123', Body: 'Please help', MessageSid: 'SM123' };

async function sendWebhook(signature?: string, payload = body, host?: string) {
  const app = Fastify();
  applications.push(app);
  installAuthentication(app);
  app.decorate('prisma', prismaMock as never);
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
  prismaMock.communicationConversation.upsert.mockResolvedValue({ id: 'conversation-1' });
  prismaMock.communicationMessage.findUnique.mockResolvedValue(null);
  prismaMock.communicationMessage.upsert.mockResolvedValue({});
  prismaMock.communicationMessage.update.mockResolvedValue({});
  prismaMock.communicationMessage.create.mockResolvedValue({});
  vi.stubEnv('TWILIO_AUTH_TOKEN', token);
  vi.stubEnv('TWILIO_WHATSAPP_WEBHOOK_URL', webhookUrl);
  vi.stubEnv('RYANAI_OWNER_PHONE', '+15555550123');
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

  it('rejects a validly signed message from a non-owner number', async () => {
    const other = { ...body, From: 'whatsapp:+15555550999' };
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, other);
    const response = await sendWebhook(signature, other);
    expect(response.statusCode).toBe(403);
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
    expect(prismaMock.communicationMessage.upsert).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      { messages: [{ role: 'user', content: 'Please help' }] },
      { configurable: { thread_id: 'whatsapp_15555550123' } },
    );
  });
});
