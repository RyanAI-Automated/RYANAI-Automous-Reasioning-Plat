// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('framer-motion', () => import('../test/mocks/framerMotion'));

import Modal from './Modal';

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

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Workspace settings">
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </Modal>
    </>
  );
}

describe('accessible modal dialog', () => {
  it('moves focus into the dialog, traps Tab, closes on Escape, and restores focus', async () => {
    await act(async () => root.render(<ModalHarness />));
    const opener = container.querySelector('button') as HTMLButtonElement;
    opener.focus();

    await act(async () => opener.click());

    const dialog = container.querySelector('[role="dialog"]');
    const closeButton = container.querySelector('button[aria-label="Close dialog"]') as HTMLButtonElement;
    const lastAction = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Last action') as HTMLButtonElement;

    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(closeButton);

    await act(async () => {
      closeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(lastAction);

    await act(async () => {
      lastAction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(closeButton);

    await act(async () => {
      closeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
