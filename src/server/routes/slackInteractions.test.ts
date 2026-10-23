import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { slackInteractionsPlugin } from './slackInteractions.js';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../agent/approvalEngine.js', () => ({ humanInTheLoopAgent: { invoke } }));
const applications: FastifyInstance[] = [];
const secret = 'synthetic-slack-signing-secret';

async function sendInteraction(sign = false) {
  const app = Fastify();
  applications.push(app);
  await app.register(slackInteractionsPlugin);
  const payload = new URLSearchParams({ payload: JSON.stringify({ actions: [] }) }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${payload}`).digest('hex');
  return app.inject({
    method: 'POST', url: '/api/slack/interactions', payload,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': sign ? signature : 'invalid',
    },
  });
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Slack interaction authentication', () => {
  it('stops processing when the signing secret is missing', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', '');
    const response = await sendInteraction();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Server security configuration error' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stops processing an invalid signature', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', secret);
    const response = await sendInteraction();
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid Slack request signature' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('allows a correctly signed request to reach the handler', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', secret);
    expect((await sendInteraction(true)).statusCode).toBe(200);
  });
});
