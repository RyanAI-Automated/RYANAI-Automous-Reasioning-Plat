// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CalculatorPage from './Calculator';

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

async function press(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Calculator key not found: ${label}`);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function display() {
  return container.querySelector('output[aria-label="Calculator display"]')?.textContent ?? '';
}

describe('calculator user interface', () => {
  it('calculates chained operations with normal precedence', async () => {
    await act(async () => root.render(<CalculatorPage />));
    await press('Digit 2');
    await press('Add');
    await press('Digit 3');
    await press('Multiply');
    await press('Digit 4');
    await press('Equals');
    expect(display()).toBe('14');
  });

  it('supports decimal entry and clear', async () => {
    await act(async () => root.render(<CalculatorPage />));
    await press('Digit 0');
    await press('Decimal point');
    await press('Digit 1');
    await press('Add');
    await press('Digit 0');
    await press('Decimal point');
    await press('Digit 2');
    await press('Equals');
    expect(display()).toBe('0.3');
    await press('Clear');
    expect(display()).toBe('0');
  });

  it('supports backspace and reports divide-by-zero safely', async () => {
    await act(async () => root.render(<CalculatorPage />));
    await press('Digit 5');
    await press('Digit 2');
    await press('Backspace');
    expect(display()).toBe('5');
    await press('Clear');
    await press('Digit 5');
    await press('Divide');
    await press('Digit 0');
    await press('Equals');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('divide by zero');
  });
});
