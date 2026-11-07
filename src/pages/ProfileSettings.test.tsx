// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileSettings from './ProfileSettings';

const auth = vi.hoisted(() => ({ updateUser: vi.fn(), getUser: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));

function getFirstUpdateData(): Record<string, unknown> {
  const updateCall = auth.updateUser.mock.calls[0];
  if (updateCall === undefined) throw new Error('Expected a Supabase Auth updateUser call.');
  return (updateCall[0] as { data: Record<string, unknown> }).data;
}
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
  auth.getUser.mockResolvedValue({ data: { user: { id: 'user-a', user_metadata: {} } }, error: null });
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
    expect(container.textContent).toContain('Credential and permission safety');
    const language = container.querySelector('select') as HTMLSelectElement;
    expect([...language.options].some((option) => option.value === 've-ZA')).toBe(true);
  });

  it('persists profile, language and voice preferences through Supabase Auth', async () => {
    await mount();
    const name = container.querySelector('input[autocomplete="name"]') as HTMLInputElement;
    const language = container.querySelector('select') as HTMLSelectElement;
    const voice = container.querySelector('[data-testid="voice-enabled-toggle"]') as HTMLInputElement;

    await changeValue(name, 'Ntsiyeni Ganyane');
    await changeValue(language, 've-ZA');
    await act(async () => {
      voice.click();
    });
    await click(container.querySelector('button[type="submit"]'));

    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalled());
    const data = getFirstUpdateData();
    expect(data).toMatchObject({
      full_name: 'Ntsiyeni Ganyane', ryanai_language: 've-ZA', ryanai_voice_enabled: true,
      ryanai_dashboard_ui_preferences: { calculator: true, audiobook: true, inferenceConsole: true, workspace: true },
      ryanai_audiobook_settings: { defaultVoice: 'coral', narrationSpeed: 1 },
      ryanai_inference_settings: { preferredModel: expect.any(String) },
    });
    expect(window.localStorage.getItem('ryanai:language:user-a')).toBe('ve-ZA');
    expect(window.localStorage.getItem('ryanai:voice-enabled')).toBe('true');
    expect(container.textContent).toContain('RyanAI Settings were saved');
  });

  it('shows provider errors and does not claim the profile was saved', async () => {
    auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Profile update temporarily unavailable.' },
    });
    await mount();
    await click(container.querySelector('button[type="submit"]'));
    await vi.waitFor(() => expect(container.textContent).toContain('Profile update temporarily unavailable.'));
    expect(container.textContent).not.toContain('RyanAI Settings were saved');
  });

  it('does not save when the identity provider returns an unverified account', async () => {
    auth.updateUser.mockResolvedValueOnce({ data: { user: { id: 'another-user' } }, error: null });
    await mount();
    await click(container.querySelector('button[type="submit"]'));
    await vi.waitFor(() => expect(container.textContent).toContain('did not confirm this Settings update'));
  });
  it('persists module switches and audiobook/inference defaults without exposing role editing', async () => {
    await mount();
    const calculator = container.querySelector('[data-testid="calculator-enabled-toggle"]') as HTMLInputElement;
    const audiobookVoice = container.querySelector('[data-testid="audiobook-default-voice"]') as HTMLSelectElement;
    const inferenceModel = container.querySelector('[data-testid="inference-default-model"]') as HTMLSelectElement;
    await act(async () => calculator.click());
    await changeValue(audiobookVoice, 'nova');
    await changeValue(inferenceModel, 'gpt-4o-mini');
    await click(container.querySelector('button[type="submit"]'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalled());
    const data = getFirstUpdateData();
    expect(data.ryanai_dashboard_ui_preferences).toMatchObject({ calculator: false });
    expect(data.ryanai_audiobook_settings).toMatchObject({ defaultVoice: 'nova', narrationSpeed: 1 });
    expect(data.ryanai_inference_settings).toMatchObject({ preferredModel: 'gpt-4o-mini' });
    expect(container.textContent).toContain('Standard user');
    expect(container.textContent).toContain('Role and owner claims cannot be edited');
    expect(container.querySelector('[data-testid="role-select"]')).toBeNull();
  });

});
