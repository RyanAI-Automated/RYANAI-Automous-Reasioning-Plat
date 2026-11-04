import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { communicationConversation: { findMany: store.findMany } },
}));

import {
  commsTools,
  getCommunicationPolicyTool,
  prepareCommunicationDraftTool,
} from './commsTools.js';
import { getRecentOwnerCommunicationsTool } from './communicationContext.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RYANAI_OWNER_PHONE', '+15555550123');
  vi.stubEnv('RYANAI_OWNER_EMAIL', 'owner@example.test');
  store.findMany.mockResolvedValue([{
    channel: 'whatsapp',
    updatedAt: new Date('2026-11-04T18:00:00.000Z'),
    messages: [{
      direction: 'inbound',
      body: 'Continue the report from our email conversation.',
      status: 'received',
      createdAt: new Date('2026-11-04T18:00:00.000Z'),
    }],
  }]);
});

afterEach(() => vi.unstubAllEnvs());

describe('restricted communications tool registry', () => {
  it('exposes only policy lookup, owner history and draft preparation', () => {
    expect(commsTools.map((entry) => entry.name)).toEqual([
      'get_communication_policy',
      'get_recent_owner_communications',
      'prepare_communication_draft',
    ]);
  });

  it('returns channel policy without enabling provider execution', async () => {
    const result = await getCommunicationPolicyTool.invoke({ channel: 'whatsapp' });
    const parsed = JSON.parse(String(result));

    expect(parsed.channel).toBe('whatsapp');
    expect(parsed.execution).toBe('disabled_in_agent_tool_registry');
    expect(parsed.approvalRequired).toBe(true);
  });

  it('prepares an email draft and clearly reports that no dispatch occurred', async () => {
    const result = await prepareCommunicationDraftTool.invoke({
      channel: 'email',
      recipient: 'owner@example.test',
      subject: 'Status update',
      message: 'The report is ready.',
    });
    const parsed = JSON.parse(String(result));

    expect(parsed.status).toBe('draft_ready');
    expect(parsed.dispatchPerformed).toBe(false);
    expect(parsed.approvalRequired).toBe(true);
    expect(parsed.recipient).toBe('owner@example.test');
    expect(parsed.subject).toBe('Status update');
  });

  it('rejects non-E.164 recipients for phone-based channels', async () => {
    await expect(prepareCommunicationDraftTool.invoke({
      channel: 'sms',
      recipient: '0712345678',
      message: 'Test message',
    })).rejects.toThrow();
  });

  it('rejects malformed email recipients', async () => {
    await expect(prepareCommunicationDraftTool.invoke({
      channel: 'email',
      recipient: 'not-an-email',
      subject: 'Test',
      message: 'Test message',
    })).rejects.toThrow();
  });

  it('retrieves recent owner conversations across channels from PostgreSQL', async () => {
    const result = await getRecentOwnerCommunicationsTool.invoke({ limit: 3 });
    const parsed = JSON.parse(String(result));
    const query = store.findMany.mock.calls[0][0];

    expect(query.where.externalAddress.in).toContain('+15555550123');
    expect(query.where.externalAddress.in).toContain('owner@example.test');
    expect(parsed.scope).toBe('configured_owner_identity_only');
    expect(parsed.conversations[0].channel).toBe('whatsapp');
    expect(parsed.conversations[0].messages[0].body).toContain('email conversation');
    expect(parsed.conversations[0].externalAddress).toBeUndefined();
  });

  it('fails closed without a configured owner identity', async () => {
    vi.stubEnv('RYANAI_OWNER_PHONE', '');
    vi.stubEnv('RYANAI_OWNER_EMAIL', '');
    const result = await getRecentOwnerCommunicationsTool.invoke({ limit: 3 });
    expect(JSON.parse(String(result)).status).toBe('unavailable');
    expect(store.findMany).not.toHaveBeenCalled();
  });
});
