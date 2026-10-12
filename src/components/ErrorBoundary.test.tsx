// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

let container: HTMLDivElement;
let root: Root;
const onError = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  onError.mockReset();
  window.addEventListener('ryanai-error', onError);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.removeEventListener('ryanai-error', onError);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function BrokenView(): never {
  throw new Error('fixture render failure');
}

describe('render error recovery', () => {
  it('renders healthy children without reporting an error', async () => {
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <p>Workspace</p>
        </ErrorBoundary>,
      ),
    );
    expect(container.textContent).toBe('Workspace');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('replaces a failed view with an accessible fallback and reports the error', async () => {
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <BrokenView />
        </ErrorBoundary>,
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'RyanAI could not load this view',
    );
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as CustomEvent).detail).toEqual({
      error: 'fixture render failure',
    });
    expect(console.error).toHaveBeenCalledWith(
      'RyanAI UI failed to render',
      expect.objectContaining({ message: 'fixture render failure' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
    const reload = vi
      .spyOn(window.location, 'reload')
      .mockImplementation(() => {});
    await act(async () => container.querySelector('button')!.click());
    expect(reload).toHaveBeenCalledOnce();
  });
});
