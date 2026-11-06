// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommunicationsCenter from './CommunicationsCenter';

const comms = vi.hoisted(() => ({
  getCommsStatus: vi.fn(),
  getCommsConversations: vi.fn(),
  sendCommsMessage: vi.fn(),\n  assistCommsConversation: vi.fn(),
  prepareCommsAttachments: vi.fn(),
  uploadCommsAttachment: vi.fn(),
  getCommsAttachmentStatuses: vi.fn(),
  getCommsAttachmentDownloadUrl: vi.fn(),
}));

vi.mock('@/lib/commsApi', () => ({
  getCommsStatus: comms.getCommsStatus,
  getCommsConversations: comms.getCommsConversations,
  sendCommsMessage: comms.sendCommsMessage,
  prepareCommsAttachments: comms.prepareCommsAttachments,
  uploadCommsAttachment: comms.uploadCommsAttachment,
  getCommsAttachmentStatuses: comms.getCommsAttachmentStatuses,
  getCommsAttachmentDownloadUrl: comms.getCommsAttachmentDownloadUrl,
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
    channels: { whatsapp: true, sms: false, voice: false, email: true, attachments: true },
    note: 'Configuration only.',
  });
  comms.getCommsConversations.mockResolvedValue(conversations);
  comms.prepareCommsAttachments.mockResolvedValue({ success: true, messageId: 'message-1', replayed: false, attachments: [] });
  comms.uploadCommsAttachment.mockResolvedValue(undefined);
  comms.getCommsAttachmentStatuses.mockResolvedValue([]);
  comms.getCommsAttachmentDownloadUrl.mockResolvedValue('https://storage.example.test/download');
  comms.assistCommsConversation.mockResolvedValue({ operation: 'summarize', output: 'Summary: delivery window remains open.', sourceMessageCount: 1 });\n  comms.sendCommsMessage.mockResolvedValue({
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

  it('exposes private file selection and clean-scan gated sharing', async () => {
    await render();
    expect(container.textContent).toContain('Private Comms attachments');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.multiple).toBe(true);
    expect(input.disabled).toBe(false);
  });

  it('shows live workspace metrics and selected conversation context from persisted data', async () => {
    await render();
    expect(container.querySelector('section[aria-label="Communication overview"]')).not.toBeNull();
    expect(container.textContent).toContain('Messages loaded');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('Conversation details');
    expect(container.textContent).toContain('Channel identity');
    expect(container.textContent).toContain('+27110000001');
    expect(container.textContent).toContain('Latest message status');
    expect(container.textContent).toContain('Privacy boundary');
  });

  it('requires a separate human review action before dispatching a message', async () => {
    await render();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Please confirm the delivery window.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain('Review before dispatch');
    expect(container.textContent).toContain('Approve & send');
    expect(comms.sendCommsMessage).not.toHaveBeenCalled();

    const approve = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Approve & send'));
    expect(approve).toBeTruthy();
    await act(async () => approve?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(comms.sendCommsMessage).toHaveBeenCalledTimes(1);
  });

  it('runs owner-scoped conversation intelligence without dispatching a message', async () => {
    await render();
    const summarize = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Summarize'));
    expect(summarize).toBeTruthy();
    await act(async () => summarize?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(comms.assistCommsConversation).toHaveBeenCalledWith({
      operation: 'summarize',
      conversationId: 'conversation-whatsapp',
      language: undefined,
    });
    expect(container.textContent).toContain('Summary: delivery window remains open.');
    expect(comms.sendCommsMessage).not.toHaveBeenCalled();
  });

  it('disables attachment selection when the server reports the private-storage or scanner gate is off', async () => {
    comms.getCommsStatus.mockResolvedValueOnce({
      status: 'configuration_snapshot',
      channels: { whatsapp: true, sms: false, voice: false, email: true, attachments: false },
      note: 'Configuration only.',
    });
    await render();
    expect(container.textContent).toContain('Disabled · storage/scanner required');
    expect(container.textContent).toContain('Uploads are disabled until owner-bound private storage and malware scanning are configured.');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.disabled).toBe(true);
  });
});
