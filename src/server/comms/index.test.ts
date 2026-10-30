import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { commsPlugin } from './index.js';
import { installAuthentication } from '../routes/auth.js';

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

const apps: FastifyInstance[] = [];
const token = 'synthetic-voice-auth-token';
const voiceUrl = 'https://ryanai.example.test/api/webhooks/twilio/voice';
const actionUrl = 'https://ryanai.example.test/api/webhooks/twilio/voice/respond';

async function send(path: string, url: string, payload: Record<string, string>, valid = true) {
  const app = Fastify();
  apps.push(app);
  installAuthentication(app);
  app.decorate('prisma', prismaMock as never);
  await app.register(commsPlugin);
  const signature = valid
    ? twilio.getExpectedTwilioSignature(token, url, payload)
    : 'invalid-signature';
  return app.inject({
    method: 'POST',
    url: path,
    payload: new URLSearchParams(payload).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
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
  vi.stubEnv('TWILIO_VOICE_WEBHOOK_URL', voiceUrl);
  vi.stubEnv('TWILIO_VOICE_ACTION_URL', actionUrl);
  vi.stubEnv('RYANAI_OWNER_PHONE', '+15555550123');
  invoke.mockResolvedValue({ messages: [{ content: 'RyanAI says hello & welcome' }] });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('Twilio conversational voice webhooks', () => {
  it('rejects forged incoming call webhooks', async () => {
    const response = await send('/api/webhooks/twilio/voice', voiceUrl, { CallSid: 'CA123', From: '+15555550123' }, false);
    expect(response.statusCode).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('answers authenticated incoming calls with a speech gather loop', async () => {
    const response = await send('/api/webhooks/twilio/voice', voiceUrl, { CallSid: 'CA123', From: '+15555550123' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/xml');
    expect(response.body).toContain('This is RyanAI. How may I assist you?');
    expect(response.body).toContain('language="en-ZA"');
    expect(response.body).toContain('<Gather input="speech" language="en-ZA"');
    expect(response.body).toContain(actionUrl);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('routes recognized speech to RyanAI and returns escaped TwiML', async () => {
    const payload = { CallSid: 'CA123', From: '+15555550123', SpeechResult: 'Please check my system' };
    const response = await send('/api/webhooks/twilio/voice/respond', actionUrl, payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('RyanAI says hello &amp; welcome');
    expect(prismaMock.communicationMessage.create).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      { messages: [{ role: 'system', content: expect.stringContaining('English - South Africa') }, { role: 'user', content: 'Please check my system' }] },
      { configurable: { thread_id: 'voice_CA123' } },
    );
  });

  it('accepts the owner as the To party on outbound AI voice calls', async () => {
    const payload = { CallSid: 'CAOUT123', From: '+15555550000', To: '+15555550123', SpeechResult: 'What is the system status?' };
    const response = await send('/api/webhooks/twilio/voice/respond', actionUrl, payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('RyanAI says hello &amp; welcome');
    expect(prismaMock.communicationMessage.create).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      { messages: [{ role: 'system', content: expect.stringContaining('English - South Africa') }, { role: 'user', content: 'What is the system status?' }] },
      { configurable: { thread_id: 'voice_CAOUT123' } },
    );
  });

  it('fails closed when the signature token is not configured', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    const response = await send('/api/webhooks/twilio/voice', voiceUrl, { CallSid: 'CA123', From: '+15555550123' });
    expect(response.statusCode).toBe(503);
  });
});
