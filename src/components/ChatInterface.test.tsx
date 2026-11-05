// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamReasoning } from '@/lib/reasoning';
import ChatInterface from './ChatInterface';

vi.mock('@/lib/reasoning', () => ({ streamReasoning: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const stream = vi.mocked(streamReasoning);
let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => root.render(<ChatInterface />));
}

async function setPrompt(value: string) {
  const textarea = container.querySelector('#inference-prompt') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector('form');
  if (!form) throw new Error('Inference form was not rendered.');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Inference Console progress and result states', () => {
  it('shows server progress while running and the completed output when reasoning finishes', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    stream.mockImplementation(async (_prompt, _model, callbacks) => {
      callbacks.onStep?.({
        type: 'reasoning',
        name: 'handoff',
        result: 'Persisted brain handoff state changed.',
      });
      await pending;
      callbacks.onToken?.('The completed reasoning result.');
      callbacks.onDone?.();
    });

    await mount();
    await setPrompt('Explain the task');
    await submit();

    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        'Persisted brain handoff state changed.',
      );
    });
    expect(container.querySelector('pre')?.textContent ?? '').toBe('');
    expect((container.querySelector('select') as HTMLSelectElement).disabled).toBe(true);

    await act(async () => release());
    await vi.waitFor(() => {
      expect(container.querySelector('pre')?.textContent).toBe('The completed reasoning result.');
    });
    expect(container.textContent).toContain('Completed');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toBe('Explain the task');
  });

  it('shows authenticated API errors and does not mark a failed run complete', async () => {
    stream.mockImplementation(async (_prompt, _model, callbacks) => {
      callbacks.onError?.('Reasoning provider request failed. Please try again later.');
    });

    await mount();
    await setPrompt('Explain the task');
    await submit();

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'Reasoning provider request failed. Please try again later.',
      );
    });
    expect(container.querySelector('pre')?.textContent ?? '').toBe('');
    expect(container.textContent).not.toContain('Completed ');
  });
});
