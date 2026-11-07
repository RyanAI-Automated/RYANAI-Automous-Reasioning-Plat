import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCommsConversations, getCommsStatus, sendCommsMessage } from './commsApi';

const request = vi.hoisted(() => vi.fn());
vi.mock('./authenticatedFetch', () => ({ authenticatedFetch: request }));

afterEach(() => request.mockReset());

describe('Comms API client', () => {
  it('reads configuration snapshot without claiming provider connectivity', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({
      status: 'configuration_snapshot', channels: { whatsapp: true }, note: 'Configuration only',
    }), { status: 200 }));
    await expect(getCommsStatus()).resolves.toMatchObject({
      status: 'configuration_snapshot', channels: { whatsapp: true },
    });
    expect(request).toHaveBeenCalledWith('/api/comms/status');
  });

  it('clamps conversation history requests and returns server messages', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
    await expect(getCommsConversations(1000)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith('/api/comms/conversations?limit=100');
  });

  it('uses the default conversation history limit for non-finite input', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
    await expect(getCommsConversations(Number.NaN)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith('/api/comms/conversations?limit=50');
  });

  it('obtains a server approval before sending through the authenticated API', async () => {
    const input = {
      channel: 'whatsapp' as const,
      recipient: '+27710000000',
      message: 'Hello',
      idempotencyKey: 'test-request-key-0001',
    };
    request
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, approvalId: 'approval-test' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, channel: 'whatsapp', providerId: 'SM-test', status: 'accepted',
      }), { status: 202 }));
    await expect(sendCommsMessage(input)).resolves.toMatchObject({ success: true, providerId: 'SM-test' });
    expect(request).toHaveBeenNthCalledWith(1, '/api/comms/approve', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
    }));
    expect(request).toHaveBeenNthCalledWith(2, '/api/comms/send', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ...input, approvalId: 'approval-test' }),
    }));
  });

  it('does not send when the server refuses to issue an owner approval', async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Owner access is required.' }), { status: 403 }));
    await expect(sendCommsMessage({
      channel: 'sms', recipient: '+27710000000', message: 'Hello', idempotencyKey: 'test-request-key-0002',
    })).rejects.toThrow('Owner access is required.');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/comms/approve', expect.any(Object));
  });

  it('surfaces server authorization errors instead of pretending a send succeeded', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: 'Owner access is required.' }), { status: 403 }));
    await expect(getCommsStatus()).rejects.toThrow('Owner access is required.');
  });
});
