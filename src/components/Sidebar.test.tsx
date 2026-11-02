// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, ModelId } from '@/lib/types';
vi.mock('framer-motion', () => import('../test/mocks/framerMotion'));

import Sidebar from './Sidebar';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const conversation: Conversation = {
  id: 'thread-1',
  title: 'Production readiness review',
  model: 'test-model' as ModelId,
  messages: [],
  createdAt: 1,
  updatedAt: 2,
};

describe('conversation sidebar actions', () => {
  it('requires an explicit confirmation before invoking delete', async () => {
    const onDelete = vi.fn();
    await act(async () => {
      root.render(
        <Sidebar
          conversations={[conversation]}
          activeId={conversation.id}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onDelete={onDelete}
          onAbout={vi.fn()}
          onMemory={vi.fn()}
          onConsole={vi.fn()}
          onGithub={vi.fn()}
        />,
      );
    });

    await act(async () => {
      (container.querySelector('button[aria-label="Delete conversation Production readiness review"]') as HTMLButtonElement).click();
    });
    expect(onDelete).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector('button[aria-label="Confirm delete Production readiness review"]') as HTMLButtonElement).click();
    });
    expect(onDelete).toHaveBeenCalledWith(conversation.id);
  });

  it('offers a clear first-conversation action when the history is empty', async () => {
    const onNew = vi.fn();
    await act(async () => {
      root.render(
        <Sidebar
          conversations={[]}
          activeId={null}
          onSelect={vi.fn()}
          onNew={onNew}
          onDelete={vi.fn()}
          onAbout={vi.fn()}
          onMemory={vi.fn()}
          onConsole={vi.fn()}
          onGithub={vi.fn()}
        />,
      );
    });

    const start = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Start a conversation');
    expect(start).not.toBeNull();
    await act(async () => (start as HTMLButtonElement).click());
    expect(onNew).toHaveBeenCalledOnce();
  });
});
