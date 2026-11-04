import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { audioIntelligenceRoutes } from './audioIntelligence.js';

const apps: FastifyInstance[] = [];
async function createApp() {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    if (request.headers.authorization === 'Bearer test-user') {
      request.authUser = { id: 'user-audio-test', email: 'audio@example.test', role: 'user', isOwner: false };
    }
  });
  await app.register(audioIntelligenceRoutes);
  await app.ready();
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RyanAI audio intelligence routes', () => {
  it('requires an authenticated user before transcription', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const app = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/audio/transcriptions', payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it('fails closed when transcription provider credentials are absent', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const app = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/audio/transcriptions', headers: { authorization: 'Bearer test-user' }, payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatch(/not configured/i);
  });

  it('rejects malformed and unsupported audio before contacting a provider', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/audio/transcriptions',
      headers: { authorization: 'Bearer test-user' },
      payload: { audioBase64: 'not-base64!', mimeType: 'application/octet-stream' },
    });
    expect(response.statusCode).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects audio whose bytes do not match the declared media type', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/audio/transcriptions',
      headers: { authorization: 'Bearer test-user' },
      payload: { audioBase64: Buffer.from('not-an-mp3').toString('base64'), mimeType: 'audio/mpeg', fileName: 'voice.mp3' },
    });
    expect(response.statusCode).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it('sends a bounded audio payload to the provider and returns normalized transcript text', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const provider = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ text: 'Hello from RyanAI.' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', provider);
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/audio/transcriptions',
      headers: { authorization: 'Bearer test-user' },
      payload: { audioBase64: Buffer.from('ID3mock-audio').toString('base64'), mimeType: 'audio/mpeg', fileName: 'chapter.mp3' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ text: 'Hello from RyanAI.', status: 'completed' });
    expect(provider).toHaveBeenCalledOnce();
    const init = provider.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
  });

  it('validates voice, speed and chapter length before synthesis', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/audio/speech',
      headers: { authorization: 'Bearer test-user' },
      payload: { text: 'Hello', voice: 'not-a-voice', speed: 9 },
    });
    expect(response.statusCode).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns an MP3 artifact from the speech provider without exposing provider credentials', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('mp3-audio'), { status: 200, headers: { 'content-type': 'audio/mpeg' } })));
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/audio/speech',
      headers: { authorization: 'Bearer test-user' },
      payload: { text: 'A short sample.', voice: 'coral', speed: 1, style: 'Warm and clear.' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mimeType: 'audio/mpeg', status: 'completed' });
    expect(response.json().audioBase64).toBe(Buffer.from('mp3-audio').toString('base64'));
    expect(response.body).not.toContain('test-key');
  });
});
