import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { commsPlugin } from './index.js';
import { ownerCommunicationInstruction } from '../../shared/ryanIdentity.js';
import { installAuthentication } from '../routes/auth.js';

const { invoke, prismaMock } = vi.hoisted(() => ({
  invoke: vi.fn(),
  prismaMock: {
    communicationConversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }), findFirst: vi.fn() },
    communicationMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
const smsUrl = 'https://ryanai.example.test/api/webhooks/twilio/sms';
const statusUrl = 'https://ryanai.example.test/api/webhooks/twilio/status';

async function send(path: string, url: string, payload: Record<string, string>, valid = true) {
  const app = Fastify();
  apps.push(app);
  installAuthentication(app);
  app.addHook('onRequest', async (request) => {
    request.authUser = { id: 'owner-test', role: 'user', isOwner: true };
  });
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
  vi.stubEnv('COMMUNICATIONS_ENABLED', 'true');
  prismaMock.communicationConversation.upsert.mockResolvedValue({ id: 'conversation-1' });
  prismaMock.communicationConversation.findFirst.mockResolvedValue({ id: 'conversation-1', messages: [{ direction: 'inbound', body: 'Please confirm the delivery window.', status: 'received', createdAt: new Date('2026-11-05T10:00:00.000Z') }] });
  prismaMock.communicationMessage.findUnique.mockResolvedValue(null);
  prismaMock.communicationMessage.upsert.mockResolvedValue({});
  prismaMock.communicationMessage.update.mockResolvedValue({});
  prismaMock.communicationMessage.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.communicationMessage.create.mockResolvedValue({});
  vi.stubEnv('TWILIO_AUTH_TOKEN', token);
  vi.stubEnv('TWILIO_VOICE_WEBHOOK_URL', voiceUrl);
  vi.stubEnv('TWILIO_VOICE_ACTION_URL', actionUrl);
  vi.stubEnv('TWILIO_SMS_WEBHOOK_URL', smsUrl);
  vi.stubEnv('TWILIO_STATUS_WEBHOOK_URL', statusUrl);
  vi.stubEnv('RYANAI_OWNER_PHONE', '+15555550123');
  vi.stubEnv('RYANAI_OWNER_TITLE', 'Sir G');
  vi.stubEnv('RYANAI_OWNER_LANGUAGE', 've-ZA');
  invoke.mockResolvedValue({ messages: [{ content: 'RyanAI says hello & welcome' }] });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('Twilio inbound SMS retry handling', () => {
  it('returns the cached response without invoking RyanAI for a retried provider event', async () => {
    const payload = { MessageSid: 'SM-duplicate-1', From: '+15555550123', Body: 'Please check my system' };
    prismaMock.communicationMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.communicationMessage.findUnique.mockResolvedValueOnce({
      status: 'replied',
      metadata: { reply: 'Certainly, Sir G. Already processed.' },
    });

    const response = await send('/api/webhooks/twilio/sms', smsUrl, payload);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Already processed.');
    expect(invoke).not.toHaveBeenCalled();
  });
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
    expect(response.body).toMatch(/Good (morning|afternoon|evening), Sir G\. This is RyanAI\. How may I assist you\?/);
    expect(response.body).toContain('Please speak after the tone.');
    expect(response.body).toContain('language="en-ZA" voice="Polly.Ayanda-Neural"');
    expect(response.body).toContain('<Gather input="speech"');
    expect(response.body).toContain(actionUrl);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('routes recognized speech to RyanAI and returns escaped TwiML', async () => {
    const payload = { CallSid: 'CA123', From: '+15555550123', SpeechResult: 'Please check my system' };
    const response = await send('/api/webhooks/twilio/voice/respond', actionUrl, payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Certainly, Sir G. RyanAI says hello &amp; welcome');
    expect(prismaMock.communicationMessage.create).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      {
        messages: [
          { role: 'system', content: ownerCommunicationInstruction() },
          { role: 'user', content: 'Please check my system' },
        ],
      },
      { configurable: { thread_id: 'voice_CA123' } },
    );
  });

  it('accepts the owner as the To party on outbound AI voice calls', async () => {
    const payload = { CallSid: 'CAOUT123', From: '+15555550000', To: '+15555550123', SpeechResult: 'What is the system status?' };
    const response = await send('/api/webhooks/twilio/voice/respond', actionUrl, payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Certainly, Sir G. RyanAI says hello &amp; welcome');
    expect(prismaMock.communicationMessage.create).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      {
        messages: [
          { role: 'system', content: ownerCommunicationInstruction() },
          { role: 'user', content: 'What is the system status?' },
        ],
      },
      { configurable: { thread_id: 'voice_CAOUT123' } },
    );
  });

  it('fails closed when the signature token is not configured', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    const response = await send('/api/webhooks/twilio/voice', voiceUrl, { CallSid: 'CA123', From: '+15555550123' });
    expect(response.statusCode).toBe(503);
  });
});


describe('Twilio delivery status callbacks', () => {
  it('updates status without replacing the existing message metadata', async () => {
    const payload = { MessageSid: 'SM-delivered-1', MessageStatus: 'delivered', ErrorCode: '' };
    const response = await send('/api/webhooks/twilio/status', statusUrl, payload);
    expect(response.statusCode).toBe(200);
    expect(prismaMock.communicationMessage.updateMany).toHaveBeenCalledWith({
      where: { providerMessageId: 'SM-delivered-1' }, data: { status: 'delivered' },
    });
  });
});

describe('Comms conversation intelligence', () => {
  it('keeps analysis owner-scoped and never dispatches a provider request', async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: 'owner-test', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);

    const response = await app.inject({
      method: 'POST',
      url: '/api/comms/assist',
      payload: { operation: 'summarize', conversationId: '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      operation: 'summarize',
      output: 'RyanAI says hello & welcome',
      sourceMessageCount: 1,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(prismaMock.communicationMessage.create).not.toHaveBeenCalled();
  });
});

describe('outbound Comms request validation', () => {
  it('requires an idempotency key before reserving or sending a provider request', async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: 'owner-test', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);

    const response = await app.inject({
      method: 'POST',
      url: '/api/comms/send',
      payload: { channel: 'whatsapp', recipient: '+15555550123', message: 'Hello Sir' },
    });

    expect(response.statusCode).toBe(400);
    expect(prismaMock.communicationConversation.upsert).not.toHaveBeenCalled();
  });
});

describe('Comms feature gates', () => {
  it('does not register communications routes when the feature is disabled', async () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', 'false');
    const response = await send('/api/comms/send', '', {});
    expect(response.statusCode).toBe(404);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('blocks attachment upload preparation until the scanner and attachment flag are enabled', async () => {
    vi.stubEnv('COMMUNICATION_ATTACHMENTS_ENABLED', 'false');
    vi.stubEnv('ATTACHMENT_SCANNER_ENABLED', 'true');
    const response = await send('/api/comms/attachments/prepare', '', {});
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Communication attachments are disabled.' });
  });
});
