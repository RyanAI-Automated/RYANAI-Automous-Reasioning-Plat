// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ErrorBoundary from './components/ErrorBoundary';

vi.mock('./App', () => ({
  default: () => <nav aria-label="Main navigation">RyanAI workspace</nav>,
}));
vi.mock('./lib/platformHealth', () => ({
  getPlatformHealth: () => new Promise(() => {}),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.restoreAllMocks());

it('mounts the UI while the backend health request remains pending', async () => {
  document.body.innerHTML = '<div id="root">Loading...</div>';
  await act(async () => {
    await import('./main');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });
  expect(document.querySelector('nav')?.textContent).toBe('RyanAI workspace');
  expect(document.getElementById('root')?.textContent).not.toContain(
    'Loading...',
  );
});

it('shows a recovery action when a view throws during rendering', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function BrokenView(): never {
    throw new Error('view failed');
  }
  try {
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenView />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'RyanAI could not load this view',
    );
    expect(container.querySelector('button')?.textContent).toBe(
      'Reload RyanAI',
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
