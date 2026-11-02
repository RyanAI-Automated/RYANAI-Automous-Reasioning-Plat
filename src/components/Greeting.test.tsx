// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Greeting from './Greeting';

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

describe('RyanAI multilingual welcome settings', () => {
  it('defaults the owner to Sir G and Tshivenda', async () => {
    await act(async () => root.render(
      <Greeting userId="owner-1" displayName="Ntsiyeni Ganyane" isOwner />,
    ));
    expect(container.textContent).toContain('Sir G');
    const language = container.querySelector('#ryanai-language') as HTMLSelectElement;
    expect(language.value).toBe('ve-ZA');
    expect(container.textContent).toContain('Tshivenda (Venda)');
  });

  it('defaults other accounts to their name and South African English', async () => {
    await act(async () => root.render(
      <Greeting userId="user-1" displayName="Alex Morgan" />,
    ));
    expect(container.textContent).toContain('Alex');
    const language = container.querySelector('#ryanai-language') as HTMLSelectElement;
    expect(language.value).toBe('en-ZA');
  });

  it('persists a selected language for the signed-in account and active reasoning session', async () => {
    await act(async () => root.render(
      <Greeting userId="owner-2" displayName="Ntsiyeni Ganyane" isOwner />,
    ));
    const language = container.querySelector('#ryanai-language') as HTMLSelectElement;
    await act(async () => {
      language.value = 'en-ZA';
      language.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(window.localStorage.getItem('ryanai:language:owner-2')).toBe('en-ZA');
    expect(window.localStorage.getItem('ryanai:language')).toBe('en-ZA');
  });

  it('offers the owner preferred-name options and device voice controls', async () => {
    await act(async () => root.render(
      <Greeting userId="owner-3" displayName="Ntsiyeni Ganyane" isOwner />,
    ));
    const title = container.querySelector('#ryanai-title') as HTMLSelectElement;
    expect([...title.options].map((option) => option.value)).toContain('Sir G');
    expect([...title.options].map((option) => option.value)).toContain('Ntsiyeni Ganyane');
    expect(container.querySelector('#ryanai-voice')).not.toBeNull();
  });
});
