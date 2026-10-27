import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ listOpenActions: vi.fn() }));
const service = vi.hoisted(() => ({ decideAction: vi.fn() }));
vi.mock('../../approvals/pendingStore.js', () => store);
vi.mock('../../approvals/service.js', () => service);
// Stand-in for the real administrator check, which needs Supabase.
vi.mock('./auth.js', () => ({
  requireAdmin: async (
    request: { authUser: { role: string } | null },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    if (request.authUser?.role !== 'admin') {
      return reply.code(403).send({ error: 'Administrator access is required.' });
    }
  },
}));

import { pendingActionsRoutes } from './pendingActions.js';

const actionId = '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11';
const admin = { 'x-test-user': 'admin-1', 'x-test-role': 'admin' };
const member = { 'x-test-user': 'user-1', 'x-test-role': 'user' };
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    (request as unknown as { authUser: unknown }).authUser = id
      ? { id: String(id), role: String(request.headers['x-test-role']) }
      : null;
  });
  await app.register(pendingActionsRoutes);
});

afterAll(() => app.close());
beforeEach(() => vi.clearAllMocks());

describe('access', () => {
  it('refuses a user who is not an administrator on every route', async () => {
    for (const [method, url] of [
      ['GET', '/api/actions'],
      ['POST', `/api/actions/${actionId}/approve`],
      ['POST', `/api/actions/${actionId}/reject`],
    ] as const) {
      const response = await app.inject({ method, url, headers: member });
      expect(response.statusCode).toBe(403);
    }
    expect(store.listOpenActions).not.toHaveBeenCalled();
    expect(service.decideAction).not.toHaveBeenCalled();
  });
});

describe('GET /api/actions', () => {
  it('lists the open actions for an administrator', async () => {
    store.listOpenActions.mockResolvedValue([{ id: actionId, summary: 'Email to a@b.com: "Hi"' }]);
    const response = await app.inject({ method: 'GET', url: '/api/actions', headers: admin });
    expect(response.statusCode).toBe(200);
    expect(response.json().actions).toHaveLength(1);
  });
});

describe('POST /api/actions/:id/approve and /reject', () => {
  it('rejects an id that is not a UUID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/actions/not-an-id/approve',
      headers: admin,
    });
    expect(response.statusCode).toBe(400);
    expect(service.decideAction).not.toHaveBeenCalled();
  });

  it('approves with the id of the administrator and returns the result', async () => {
    service.decideAction.mockResolvedValue({ outcome: 'executed', result: 'Email sent.' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
      headers: admin,
    });
    expect(service.decideAction).toHaveBeenCalledWith(actionId, 'admin-1', true);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'executed', result: 'Email sent.' });
  });

  it('rejects an action', async () => {
    service.decideAction.mockResolvedValue({ outcome: 'rejected' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/reject`,
      headers: admin,
    });
    expect(service.decideAction).toHaveBeenCalledWith(actionId, 'admin-1', false);
    expect(response.json()).toEqual({ status: 'rejected' });
  });

  it('returns 404 when the action is decided already, expired, or unknown', async () => {
    service.decideAction.mockResolvedValue({ outcome: 'not_found' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
      headers: admin,
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 502 with the error when the send fails', async () => {
    service.decideAction.mockResolvedValue({
      outcome: 'failed',
      error: 'Twilio is not configured on this server.',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
      headers: admin,
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      status: 'failed',
      error: 'Twilio is not configured on this server.',
    });
  });
});
