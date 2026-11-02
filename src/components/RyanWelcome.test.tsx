// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RyanWelcome from './RyanWelcome';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('RyanAI personalized welcome', () => {
  it('greets other signed-in users by their first name', async () => {
    await act(async () => root.render(
      <RyanWelcome userId="user-1" displayName="Alex Morgan" />,
    ));
    expect(container.textContent).toContain('Alex.');
    expect(container.textContent).toContain('English (South Africa)');
  });

  it('greets the owner as Sir when that title is configured', async () => {
    await act(async () => root.render(
      <RyanWelcome userId="owner-1" displayName="Owner Name" preferredTitle="Sir" />,
    ));
    expect(container.textContent).toContain('Sir.');
  });

  it('lets a user select Sir and persists that preference for their account on this device', async () => {
    await act(async () => root.render(
      <RyanWelcome userId="owner-2" displayName="Owner Name" />,
    ));
    const select = container.querySelector('#ryanai-title-choice') as HTMLSelectElement;
    await act(async () => {
      select.value = 'Sir';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Sir.');
    expect(window.localStorage.getItem('ryanai:preferred-title:owner-2')).toBe('Sir');
  });
});
