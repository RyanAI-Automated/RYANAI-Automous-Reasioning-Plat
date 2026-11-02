import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const patcher = vi.hoisted(() => ({ proposePullRequest: vi.fn() }));
vi.mock('../../engine/selfPatchSkill.js', () => ({ SelfPatchSkill: patcher }));
vi.mock('../../integrations/jarvis/client.js', () => ({
  jarvisClient: { status: vi.fn(), submitPatch: vi.fn(), publishStack: vi.fn() },
  JarvisIntegrationError: class JarvisIntegrationError extends Error {
    constructor(public readonly statusCode: number, message: string) { super(message); }
  },
}));
vi.mock('../../integrations/jarvis/stackManifest.js', () => ({
  buildRyanAIStackManifest: vi.fn(),
}));
vi.mock('./auth.js', () => ({
  requireAdmin: async (
    request: { authUser: { role: string } | null },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
  },
}));

import { jarvisRoutes } from './jarvisRoutes.js';

const admin = { 'x-test-user': 'jarvis-service', 'x-test-role': 'admin' };
let app: FastifyInstance;
const originalEnabled = process.env.JARVIS_PATCH_INGRESS_ENABLED;
const originalToken = process.env.JARVIS_INGRESS_TOKEN;

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    (request as unknown as { authUser: unknown }).authUser = id
      ? { id: String(id), role: String(request.headers['x-test-role']) }
      : null;
  });
  await app.register(jarvisRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (originalEnabled === undefined) delete process.env.JARVIS_PATCH_INGRESS_ENABLED;
  else process.env.JARVIS_PATCH_INGRESS_ENABLED = originalEnabled;
  if (originalToken === undefined) delete process.env.JARVIS_INGRESS_TOKEN;
  else process.env.JARVIS_INGRESS_TOKEN = originalToken;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JARVIS_PATCH_INGRESS_ENABLED = 'true';
  process.env.JARVIS_INGRESS_TOKEN = 'fixture-ingress-token-32-bytes';
});

describe('POST /api/jarvis/patches/apply', () => {
  const payload = { filePath: 'src/agent/example.ts', patchContent: 'export const candidate = true;' };

  it('fails closed while ingress is disabled or unconfigured', async () => {
    process.env.JARVIS_PATCH_INGRESS_ENABLED = 'false';
    const disabled = await app.inject({ method: 'POST', url: '/api/jarvis/patches/apply', headers: admin, payload });
    expect(disabled.statusCode).toBe(404);
    process.env.JARVIS_PATCH_INGRESS_ENABLED = 'true';
    delete process.env.JARVIS_INGRESS_TOKEN;
    const unconfigured = await app.inject({ method: 'POST', url: '/api/jarvis/patches/apply', headers: admin, payload });
    expect(unconfigured.statusCode).toBe(503);
    expect(patcher.proposePullRequest).not.toHaveBeenCalled();
  });

  it('rejects missing and invalid bearer tokens before invoking patch logic', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/jarvis/patches/apply', payload });
    const invalid = await app.inject({ method: 'POST', url: '/api/jarvis/patches/apply', headers: { authorization: 'Bearer wrong-token' }, payload });
    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(patcher.proposePullRequest).not.toHaveBeenCalled();
  });

  it('rejects bearer credentials containing embedded whitespace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/jarvis/patches/apply',
      headers: { authorization: 'Bearer fixture-ingress token-32-bytes' },
      payload,
    });
    expect(response.statusCode).toBe(401);
    expect(patcher.proposePullRequest).not.toHaveBeenCalled();
  });

  it('requires valid machine credentials and creates a reviewable PR proposal, not a live workspace write', async () => {
    patcher.proposePullRequest.mockResolvedValue({
      status: 'proposed',
      pullRequestUrl: 'https://github.com/example/repo/pull/42',
      commitSha: 'candidate-sha',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/jarvis/patches/apply',
      headers: { authorization: 'Bearer fixture-ingress-token-32-bytes' },
      payload,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().success).toBe(true);
    expect(response.json().result.pullRequestUrl).toContain('/pull/42');
    expect(patcher.proposePullRequest).toHaveBeenCalledWith(payload);
  });

  it('maps rejected candidates to 422 and does not report success', async () => {
    patcher.proposePullRequest.mockResolvedValue({ status: 'rejected', error: 'Credential content rejected.' });
    const response = await app.inject({
      method: 'POST', url: '/api/jarvis/patches/apply',
      headers: { authorization: 'Bearer fixture-ingress-token-32-bytes' }, payload,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().success).toBe(false);
  });

  it('maps missing GitHub integration to 503 without exposing credentials', async () => {
    patcher.proposePullRequest.mockResolvedValue({ status: 'unavailable', error: 'GitHub patch integration is not configured.' });
    const response = await app.inject({
      method: 'POST', url: '/api/jarvis/patches/apply',
      headers: { authorization: 'Bearer fixture-ingress-token-32-bytes' }, payload,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().success).toBe(false);
  });

  it('rejects malformed payloads before invoking patch logic', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/jarvis/patches/apply',
      headers: { authorization: 'Bearer fixture-ingress-token-32-bytes' },
      payload: { ...payload, unexpected: true },
    });
    expect(response.statusCode).toBe(400);
    expect(patcher.proposePullRequest).not.toHaveBeenCalled();
  });

  it('does not require machine-token authentication for separate administrator routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/jarvis/status' });
    expect(response.statusCode).toBe(401);
  });
});
