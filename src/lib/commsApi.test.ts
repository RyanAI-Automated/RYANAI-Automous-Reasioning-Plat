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

  it('sends through the authenticated API without exposing provider keys', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({
      success: true, channel: 'whatsapp', providerId: 'SM-test', status: 'accepted',
    }), { status: 202 }));
    await expect(sendCommsMessage({
      channel: 'whatsapp', recipient: '+27710000000', message: 'Hello',
    })).resolves.toMatchObject({ success: true, providerId: 'SM-test' });
    expect(request).toHaveBeenCalledWith('/api/comms/send', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ channel: 'whatsapp', recipient: '+27710000000', message: 'Hello' }),
    }));
  });

  it('surfaces server authorization errors instead of pretending a send succeeded', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: 'Owner access is required.' }), { status: 403 }));
    await expect(getCommsStatus()).rejects.toThrow('Owner access is required.');
  });
});
