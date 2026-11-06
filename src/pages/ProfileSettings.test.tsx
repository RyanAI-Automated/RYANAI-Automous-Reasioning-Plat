// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileSettings from './ProfileSettings';

const auth = vi.hoisted(() => ({ updateUser: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const allRegularUiIds = [
  'pa',
  'cockpit',
  'operator',
  'operations',
  'calculator',
  'quant',
  'trading',
  'workspace',
  'audiobook',
];

async function mount({ isOwner = false, isAdmin = false }: { isOwner?: boolean; isAdmin?: boolean } = {}) {
  await act(async () => root.render(
    <ProfileSettings
      userId="user-a"
      email="person@example.test"
      initialDisplayName="Alex Morgan"
      initialLanguage="en-ZA"
      initialVoiceEnabled={false}
      initialDashboardUiIds={allRegularUiIds}
      isOwner={isOwner}
      isAdmin={isAdmin}
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

function buttonContaining(label: string) {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(label)) ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
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

describe('RyanAI Settings', () => {
  it('shows profile identity, dashboard controls and supported language preferences', async () => {
    await mount();
    expect(container.textContent).toContain('person@example.test');
    expect(container.textContent).toContain('Provider and integration security');
    expect(container.textContent).toContain('Dashboard UI options');
    expect(container.textContent).toContain('Account security');
    expect(container.querySelector('input[data-ui-id="calculator"]')).not.toBeNull();
    const language = container.querySelector('select') as HTMLSelectElement;
    expect([...language.options].some((option) => option.value === 've-ZA')).toBe(true);
  });

  it('does not expose owner or admin workspaces to an ordinary account', async () => {
    await mount();

    expect(container.querySelector('input[data-ui-id="comms"]')).toBeNull();
    expect(container.querySelector('input[data-ui-id="admin"]')).toBeNull();
    expect(container.querySelector('input[data-ui-id="studio"]')).toBeNull();
  });

  it('exposes only the owner workspace when the trusted owner claim is present', async () => {
    await mount({ isOwner: true });

    expect(container.querySelector('input[data-ui-id="comms"]')).not.toBeNull();
    expect(container.querySelector('input[data-ui-id="admin"]')).toBeNull();
    expect(container.querySelector('input[data-ui-id="studio"]')).toBeNull();
  });

  it('exposes admin workspaces without granting the owner-only Comms workspace', async () => {
    await mount({ isAdmin: true });

    expect(container.querySelector('input[data-ui-id="admin"]')).not.toBeNull();
    expect(container.querySelector('input[data-ui-id="studio"]')).not.toBeNull();
    expect(container.querySelector('input[data-ui-id="comms"]')).toBeNull();
  });

  it('persists profile, language, voice and selected dashboard UIs through Supabase Auth', async () => {
    await mount();
    const name = container.querySelector('input[autocomplete="name"]') as HTMLInputElement;
    const language = container.querySelector('select') as HTMLSelectElement;
    const voice = container.querySelector('input[data-testid="voice-enabled"]') as HTMLInputElement;
    const calculator = container.querySelector('input[data-ui-id="calculator"]') as HTMLInputElement;
    auth.updateUser.mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-a',
          user_metadata: {
            full_name: 'Ntsiyeni Ganyane',
            ryanai_language: 've-ZA',
            ryanai_voice_enabled: true,
            ryanai_dashboard_ui: ['pa', 'cockpit', 'operator', 'operations', 'quant', 'trading', 'workspace', 'audiobook'],
          },
        },
      },
      error: null,
    });

    await changeValue(name, 'Ntsiyeni Ganyane');
    await changeValue(language, 've-ZA');
    await act(async () => {
      voice.click();
      calculator.click();
    });
    await click(buttonContaining('Save profile & dashboard settings'));

    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({
      data: {
        full_name: 'Ntsiyeni Ganyane',
        ryanai_language: 've-ZA',
        ryanai_voice_enabled: true,
        ryanai_dashboard_ui: [
          'pa',
          'cockpit',
          'operator',
          'operations',
          'quant',
          'trading',
          'workspace',
          'audiobook',
        ],
      },
    }));
    expect(window.localStorage.getItem('ryanai:language:user-a')).toBe('ve-ZA');
    expect(window.localStorage.getItem('ryanai:voice-enabled')).toBe('true');
    expect(container.textContent).toContain('Profile, dashboard visibility and preferences saved');
  });

  it('requests email changes through the authenticated Supabase user flow', async () => {
    await mount();
    await changeValue(container.querySelector('input[type="email"]') as HTMLInputElement, 'new@example.test');
    await click(buttonContaining('Request email change'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ email: 'new@example.test' }));
    expect(container.textContent).toContain('Complete the verification steps');
  });

  it('updates a password only after validating length and confirmation', async () => {
    await mount();
    const passwordInputs = [...container.querySelectorAll('input[type="password"]')] as HTMLInputElement[];
    await changeValue(passwordInputs[0], 'old-password-value');
    await changeValue(passwordInputs[1], 'correct-horse-battery');
    await changeValue(passwordInputs[2], 'correct-horse-battery');
    await click(buttonContaining('Update password'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'correct-horse-battery', currentPassword: 'old-password-value' }));
    expect(container.textContent).toContain('Password update confirmed');
  });

  it('invalidates other device sessions without signing out the current device', async () => {
    await mount();
    await click(buttonContaining('Sign out other devices'));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    await vi.waitFor(() => expect(container.textContent).toContain('This device remains signed in'));
  });

  it('shows provider errors and does not claim the profile was saved', async () => {
    auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Profile update temporarily unavailable.' },
    });
    await mount();
    await click(buttonContaining('Save profile & dashboard settings'));
    await vi.waitFor(() => expect(container.textContent).toContain('Profile update temporarily unavailable.'));
    expect(container.textContent).not.toContain('Profile, dashboard visibility and preferences saved');
  });

  it('does not save when the identity provider returns an unverified account', async () => {
    auth.updateUser.mockResolvedValueOnce({ data: { user: { id: 'another-user' } }, error: null });
    await mount();
    await click(buttonContaining('Save profile & dashboard settings'));
    await vi.waitFor(() => expect(container.textContent).toContain('did not confirm this profile update'));
  });
});
