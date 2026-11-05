// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileSettings from './ProfileSettings';

const auth = vi.hoisted(() => ({ updateUser: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => root.render(
    <ProfileSettings
      userId="user-a"
      email="person@example.test"
      initialDisplayName="Alex Morgan"
      initialLanguage="en-ZA"
      initialVoiceEnabled={false}
    />,
  ));
}

async function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(element: Element | null) {
  if (!element) throw new Error('Expected control was not found.');
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Profile & Settings', () => {
  it('shows the verified account identity and supported language preferences', async () => {
    await mount();
    expect(container.textContent).toContain('person@example.test');
    expect(container.textContent).toContain('Provider and integration security');
    const language = container.querySelector('select') as HTMLSelectElement;
    expect([...language.options].some((option) => option.value === 've-ZA')).toBe(true);
  });

  it('persists profile, language and voice preferences through Supabase Auth', async () => {
    await mount();
    const name = container.querySelector('input[autocomplete="name"]') as HTMLInputElement;
    const language = container.querySelector('select') as HTMLSelectElement;
    const voice = container.querySelector('input[type="checkbox"]') as HTMLInputElement;

    await changeValue(name, 'Ntsiyeni Ganyane');
    await changeValue(language, 've-ZA');
    await act(async () => {
      voice.click();
    });
    await click(container.querySelector('button[type="submit"]'));

    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({
      data: {
        full_name: 'Ntsiyeni Ganyane',
        ryanai_language: 've-ZA',
        ryanai_voice_enabled: true,
      },
    }));
    expect(window.localStorage.getItem('ryanai:language:user-a')).toBe('ve-ZA');
    expect(window.localStorage.getItem('ryanai:voice-enabled')).toBe('true');
    expect(container.textContent).toContain('Profile and preferences saved');
  });

  it('shows provider errors and does not claim the profile was saved', async () => {
    auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Profile update temporarily unavailable.' },
    });
    await mount();
    await click(container.querySelector('button[type="submit"]'));
    await vi.waitFor(() => expect(container.textContent).toContain('Profile update temporarily unavailable.'));
    expect(container.textContent).not.toContain('Profile and preferences saved');
  });

  it('does not save when the identity provider returns an unverified account', async () => {
    auth.updateUser.mockResolvedValueOnce({ data: { user: { id: 'another-user' } }, error: null });
    await mount();
    await click(container.querySelector('button[type="submit"]'));
    await vi.waitFor(() => expect(container.textContent).toContain('did not confirm this profile update'));
  });
});
