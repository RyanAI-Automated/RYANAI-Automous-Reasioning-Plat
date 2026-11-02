// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL } from '@/lib/models';
import type { Message, MessageAttachment, ModelId } from '@/lib/types';
import ChatPanel from './ChatPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const imageAttachment: MessageAttachment = {
  id: 'image-1',
  name: 'diagram.png',
  mimeType: 'image/png',
  size: 512,
  path: 'user-1/conversation-1/message-1/image-1-diagram.png',
  url: 'https://storage.example.test/old-image-signed-url',
};

const videoAttachment: MessageAttachment = {
  id: 'video-1',
  name: 'walkthrough.mp4',
  mimeType: 'video/mp4',
  size: 1024,
  path: 'user-1/conversation-1/message-1/video-1-walkthrough.mp4',
  url: 'https://storage.example.test/old-video-signed-url',
};

const audioAttachment: MessageAttachment = {
  id: 'audio-1',
  name: 'voice-note.mp3',
  mimeType: 'audio/mpeg',
  size: 256,
  path: 'user-1/conversation-1/message-1/audio-1-voice-note.mp3',
  url: 'https://storage.example.test/old-audio-signed-url',
};

const message: Message = {
  id: 'message-1',
  role: 'user',
  content: 'Please review these media files.',
  timestamp: 1,
  attachments: [imageAttachment, videoAttachment, audioAttachment],
};

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    messages: [message],
    model: DEFAULT_MODEL as ModelId,
    onModelChange: vi.fn(),
    sending: false,
    liveText: '',
    liveModel: DEFAULT_MODEL as ModelId,
    onSend: vi.fn().mockResolvedValue(undefined),
    attachmentsEnabled: true,
    onExport: vi.fn(),
    onImport: vi.fn().mockResolvedValue(undefined),
    onRefreshAttachment: vi.fn().mockImplementation(async (attachment: MessageAttachment) =>
      `https://storage.example.test/fresh/${attachment.id}`,
    ),
    activeTitle: 'Media review',
    onOpenLeft: vi.fn(),
    onOpenRight: vi.fn(),
    voiceState: 'idle' as const,
    voiceInterim: '',
    voiceSupported: false,
    onVoiceToggle: vi.fn(),
    ...overrides,
  };
}

async function mount(props = baseProps()) {
  await act(async () => {
    root.render(<ChatPanel {...props} />);
  });
}

function dispatchFileEvent(target: Element, type: 'dragover' | 'drop', file: File) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: [file],
      dropEffect: 'none',
    },
  });
  target.dispatchEvent(event);
  return event;
}

describe('chat attachment experience', () => {
  it('renders safe image, video, and audio preview controls', async () => {
    await mount();

    expect(container.querySelector('img[alt="diagram.png"]')).not.toBeNull();
    expect(container.querySelector('video[aria-label="Preview walkthrough.mp4"]')).not.toBeNull();
    expect(container.querySelector('audio[aria-label="Preview voice-note.mp3"]')).not.toBeNull();
  });

  it('adds allowlisted files dropped into the message area to the selected attachment list', async () => {
    await mount(baseProps({ messages: [] }));
    const messageLog = container.querySelector('[role="log"]');
    expect(messageLog).not.toBeNull();

    const file = new File(['%PDF-1.7 test'], 'reference.pdf', { type: 'application/pdf' });
    await act(async () => {
      dispatchFileEvent(messageLog as Element, 'dragover', file);
    });
    expect(container.textContent).toContain('Drop files to attach');

    await act(async () => {
      dispatchFileEvent(messageLog as Element, 'drop', file);
    });

    expect(container.textContent).toContain('reference.pdf');
    expect(container.querySelector('[aria-label="Selected attachments"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Drop files to attach');
  });

  it('opens a fresh signed URL rather than the stale URL captured at initial load', async () => {
    const refreshed = 'https://storage.example.test/fresh/image-1';
    const onRefreshAttachment = vi.fn().mockResolvedValue(refreshed);
    const replace = vi.fn();
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      opener: window,
      location: { replace },
      close,
    } as unknown as Window);

    await mount(baseProps({ onRefreshAttachment }));

    const link = container.querySelector('a[aria-label="Open attachment diagram.png in a new tab"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();

    await act(async () => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onRefreshAttachment).toHaveBeenCalledWith(imageAttachment);
    expect(replace).toHaveBeenCalledWith(refreshed);
  });
});
