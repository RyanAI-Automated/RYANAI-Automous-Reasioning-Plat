import { describe, expect, it } from 'vitest';
import {
  getCommunicationPolicyTool,
  prepareCommunicationDraftTool,
} from './commsTools.js';

describe('restricted communications tool registry', () => {
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
});
