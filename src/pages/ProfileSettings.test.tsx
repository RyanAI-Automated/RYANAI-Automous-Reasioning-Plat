// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileSettings from './ProfileSettings';

const auth = vi.hoisted(() => ({
  updateUser: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

async function mount(options: { isOwner?: boolean; isAdmin?: boolean } = {}) {
  await act(async () => root.render(
    <ProfileSettings
      userId="user-a"
      email="person@example.test"
      initialDisplayName="Alex Morgan"
      initialLanguage="en-ZA"
      initialVoiceEnabled={false}
      initialDashboardUiPreferences={{}}
      isOwner={options.isOwner}
      isAdmin={options.isAdmin}
    />,
  ));
}

async function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(element: Element | null) {
  if (!element) throw new Error('Expected control was not found.');
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function buttonContaining(label: string) {
  return [...container.querySelectorAll('button')].find(button => button.textContent?.includes(label)) ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'user-a', user_metadata: {} } }, error: null });
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
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
  it('renders profile, dashboard, module and account security controls', async () => {
    await mount();
    expect(container.textContent).toContain('Profile management & access control');
    expect(container.textContent).toContain('Account security');
    expect(container.textContent).toContain('Provider and integration security');
    expect(container.querySelector('[data-testid="calculator-enabled-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="voice-enabled-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="audiobook-default-voice"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="inference-default-model"]')).not.toBeNull();
  });

  it('does not expose privileged workspace toggles to standard users', async () => {
    await mount();
    expect((container.querySelector('[data-testid="ui-toggle-admin"]') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="ui-toggle-studio"]') as HTMLInputElement).disabled).toBe(false);
    expect((container.querySelector('[data-testid="ui-toggle-comms"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('exposes only the privileged workspaces allowed by the trusted role', async () => {
    await mount({ isAdmin: true });
    expect((container.querySelector('[data-testid="ui-toggle-admin"]') as HTMLInputElement).disabled).toBe(false);
    expect((container.querySelector('[data-testid="ui-toggle-studio"]') as HTMLInputElement).disabled).toBe(false);
    expect((container.querySelector('[data-testid="ui-toggle-comms"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('persists profile and module preferences only after verifying the account', async () => {
    await mount();
    await changeValue(container.querySelector('input[autocomplete="name"]') as HTMLInputElement, 'Ntsiyeni Ganyane');
    await changeValue(container.querySelector('optgroup[label="South African languages"]')?.parentElement as HTMLSelectElement, 've-ZA');
    await act(async () => {
      (container.querySelector('[data-testid="voice-enabled-toggle"]') as HTMLInputElement).click();
      (container.querySelector('[data-testid="calculator-enabled-toggle"]') as HTMLInputElement).click();
    });
    await click(buttonContaining('Save all Settings'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalled());
    expect(auth.getUser).toHaveBeenCalled();
    const payload = auth.updateUser.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      full_name: 'Ntsiyeni Ganyane',
      ryanai_language: 've-ZA',
      ryanai_voice_enabled: true,
      ryanai_dashboard_ui_preferences: { calculator: false },
      ryanai_audiobook_settings: { defaultVoice: 'coral', narrationSpeed: 1 },
    });
    expect(window.localStorage.getItem('ryanai:language:user-a')).toBe('ve-ZA');
    expect(container.textContent).toContain('RyanAI Settings were saved');
  });

  it('requests email changes through Supabase Auth', async () => {
    await mount();
    await changeValue(container.querySelector('input[type="email"]') as HTMLInputElement, 'new@example.test');
    await click(buttonContaining('Request email change'));
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ email: 'new@example.test' }));
    expect(container.textContent).toContain('Complete the verification steps');
  });

  it('reauthenticates before updating a password', async () => {
    await mount();
    const passwords = [...container.querySelectorAll('input[type="password"]')] as HTMLInputElement[];
    await changeValue(passwords[0], 'current-password-value');
    await changeValue(passwords[1], 'new-password-value-123');
    await changeValue(passwords[2], 'new-password-value-123');
    await click(buttonContaining('Update password'));
    await vi.waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'person@example.test',
      password: 'current-password-value',
    }));
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password-value-123' });
    expect(container.textContent).toContain('Password update confirmed');
  });

  it('invalidates other refresh-token sessions without signing out this device', async () => {
    await mount();
    await click(buttonContaining('Sign out other devices'));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    await vi.waitFor(() => expect(container.textContent).toContain('This device remains signed in'));
  });
});
