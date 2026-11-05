// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommunicationsCenter from './CommunicationsCenter';

const comms = vi.hoisted(() => ({
  getCommsStatus: vi.fn(),
  getCommsConversations: vi.fn(),
  sendCommsMessage: vi.fn(),
}));

vi.mock('@/lib/commsApi', () => ({
  getCommsStatus: comms.getCommsStatus,
  getCommsConversations: comms.getCommsConversations,
  sendCommsMessage: comms.sendCommsMessage,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const conversations = [
  {
    id: 'conversation-whatsapp',
    channel: 'whatsapp',
    externalAddress: '+27110000001',
    updatedAt: '2026-11-05T10:00:00.000Z',
    messages: [{
      id: 'message-whatsapp',
      direction: 'inbound',
      body: 'Please confirm the delivery window.',
      status: 'received',
      providerMessageId: null,
      metadata: null,
      createdAt: '2026-11-05T10:00:00.000Z',
    }],
  },
  {
    id: 'conversation-email',
    channel: 'email',
    externalAddress: 'client@example.com',
    updatedAt: '2026-11-05T11:00:00.000Z',
    messages: [{
      id: 'message-email',
      direction: 'inbound',
      body: 'The invoice reference is RYAN-2048.',
      status: 'received',
      providerMessageId: null,
      metadata: null,
      createdAt: '2026-11-05T11:00:00.000Z',
    }],
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  comms.getCommsStatus.mockResolvedValue({
    status: 'configuration_snapshot',
    channels: { whatsapp: true, sms: false, voice: false, email: true },
    note: 'Configuration only.',
  });
  comms.getCommsConversations.mockResolvedValue(conversations);
  comms.sendCommsMessage.mockResolvedValue({
    success: true,
    channel: 'whatsapp',
    providerId: 'provider-message',
    status: 'accepted',
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<CommunicationsCenter />);
    await new Promise((resolve) => window.setTimeout(resolve, 5));
  });
}

describe('RyanAI Comms inbox controls', () => {
  it('searches persisted message bodies and recipient addresses', async () => {
    await render();
    expect(container.textContent).toContain('2 / 2');

    const search = container.querySelector('input[placeholder="Search this inbox…"]') as HTMLInputElement;
    expect(search).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'RYAN-2048');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.textContent).toContain('1 / 2');
    const list = container.querySelector('aside');
    expect(list?.textContent).toContain('client@example.com');
    expect(list?.textContent).not.toContain('+27110000001');
  });

  it('filters the conversation list by channel', async () => {
    await render();
    const channelFilter = container.querySelector('aside select') as HTMLSelectElement;
    expect(channelFilter).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(channelFilter, 'email');
      channelFilter.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('1 / 2');
    const list = container.querySelector('aside');
    expect(list?.textContent).toContain('client@example.com');
    expect(list?.textContent).not.toContain('+27110000001');
  });

  it('explains that Comms attachments remain disabled until their own security controls exist', async () => {
    await render();
    expect(container.textContent).toContain('Comms attachments are locked pending secure storage integration.');
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
