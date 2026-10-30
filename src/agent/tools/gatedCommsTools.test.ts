import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ createPendingAction: vi.fn() }));
vi.mock('../../approvals/pendingStore.js', () => store);

import { queueEmailTool, queueSmsTool, queueVoiceCallTool, queueWhatsAppTool } from './gatedCommsTools.js';

const asUser = { configurable: { userId: 'user-1' } };
const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  store.createPendingAction.mockResolvedValue({
    id: 'a1',
    summary: 'Email to ada@example.com: "Hello"',
    expiresAt: new Date('2026-10-28T10:00:00Z'),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('gated communication tools', () => {
  it('queue an email for the signed-in user and send nothing', async () => {
    const result = JSON.parse(
      await queueEmailTool.invoke(
        { to: 'ada@example.com', subject: 'Hello', html: '<p>Hi</p>' },
        asUser,
      ),
    );
    expect(store.createPendingAction).toHaveBeenCalledWith('user-1', 'send_email', {
      to: 'ada@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });
    expect(result).toEqual(
      expect.objectContaining({ status: 'PENDING_APPROVAL', id: 'a1' }),
    );
    expect(result.message).toMatch(/Nothing has been sent/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queues SMS to the owner by default', async () => {
    vi.stubEnv('RYANAI_OWNER_PHONE', '+27718095084');
    await queueSmsTool.invoke({ message: 'System alert' }, asUser);
    expect(store.createPendingAction).toHaveBeenLastCalledWith('user-1', 'send_sms_message', {
      to: '+27718095084', message: 'System alert',
    });
  });

  it('queue a message and a call with a cleaned phone number', async () => {
    await queueWhatsAppTool.invoke({ to: '+1 (234) 567-890', message: 'Hi' }, asUser);
    expect(store.createPendingAction).toHaveBeenLastCalledWith('user-1', 'send_whatsapp_message', {
      to: '+1234567890',
      message: 'Hi',
    });
    await queueVoiceCallTool.invoke({ to: '+1234567890', twimlMessage: 'Hello' }, asUser);
    expect(store.createPendingAction).toHaveBeenLastCalledWith('user-1', 'make_voice_call', {
      to: '+1234567890',
      twimlMessage: 'Hello',
    });
  });

  it('refuse a bad number before anything is queued', async () => {
    await expect(
      queueWhatsAppTool.invoke({ to: '12345', message: 'Hi' }, asUser),
    ).rejects.toThrow(/international format/);
    expect(store.createPendingAction).not.toHaveBeenCalled();
  });

  it('fail without a signed-in user and queue nothing', async () => {
    await expect(
      queueEmailTool.invoke({ to: 'ada@example.com', subject: 'Hello', html: 'x' }),
    ).rejects.toThrow(/authenticated user/);
    expect(store.createPendingAction).not.toHaveBeenCalled();
  });
});
