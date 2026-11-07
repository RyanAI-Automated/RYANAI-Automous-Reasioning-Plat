// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginIntegrationsSettings from './PluginIntegrationsSettings';

const auth = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement; let root: Root;
async function mount(options: { isOwner?: boolean; isAdmin?: boolean; initialPreferences?: unknown } = {}) {
  await act(async () => root.render(<PluginIntegrationsSettings userId="user-a" {...options} />));
}
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(element: Element | null) { if (!element) throw new Error('Control not found'); await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'user-a', user_metadata: {} } }, error: null });
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
describe('Plugin integrations centre', () => {
  it('lists integrations across workforce, PA, Comms, knowledge and research categories', async () => {
    await mount();
    expect(container.textContent).toContain('Plugin & integrations centre');
    expect(container.textContent).toContain('GitHub');
    expect(container.textContent).toContain('WhatsApp Business');
    expect(container.textContent).toContain('Google Calendar');
    expect(container.textContent).toContain('Adapter required');
  });
  it('filters providers by search and category', async () => {
    await mount();
    await change(container.querySelector('[aria-label="Search integrations"]') as HTMLInputElement, 'calendar');
    expect(container.textContent).toContain('Google Calendar');
    expect(container.textContent).not.toContain('WhatsApp Business');
  });
  it('does not expose owner-only communications integrations to standard users', async () => {
    await mount();
    const toggle = container.querySelector('[aria-label="Request WhatsApp Business for eligible workers"]') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
  });
  it('persists preferences only after verifying the authenticated account', async () => {
    await mount({ isOwner: true });
    const toggle = container.querySelector('[aria-label="Request WhatsApp Business for eligible workers"]') as HTMLInputElement;
    await act(async () => { toggle.click(); });
    await click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Save plugin preferences')) ?? null);
    expect(auth.getUser).toHaveBeenCalled();
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { ryanai_plugin_preferences: expect.objectContaining({ 'whatsapp-business': expect.objectContaining({ enabled: true }) }) } });
    expect(container.textContent).toContain('No provider has been connected');
  });
  it('rejects a mismatched authenticated account', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'other-user' } }, error: null });
    await mount();
    await click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Save plugin preferences')) ?? null);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(container.textContent).toContain('session could not be verified');
  });
});
