// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OAuthConsentPage from './OAuthConsentPage';

const oauth = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: oauth.getUser, oauth } } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
const request = {
  authorization_id: 'authorization-123',
  client: { id: 'client-456', name: 'RyanAI MCP Connector' },
  redirect_uri: 'https://client.example.test/oauth/callback',
  scope: 'openid email profile',
};

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/oauth/consent?authorization_id=authorization-123');
  oauth.getUser.mockResolvedValue({ data: { user: { id: 'user-123', is_anonymous: false } }, error: null });
  oauth.getAuthorizationDetails.mockResolvedValue({ data: request, error: null });
  oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'https://client.example.test/oauth/callback?code=approved' }, error: null });
  oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: 'https://client.example.test/oauth/callback?error=access_denied' }, error: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function mount(onRedirect = vi.fn()) {
  await act(async () => root.render(<OAuthConsentPage userId="user-123" onRedirect={onRedirect} />));
  await vi.waitFor(() => expect(container.textContent).toContain('RyanAI MCP Connector'));
  return onRedirect;
}
function buttonContaining(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

describe('Supabase OAuth Server consent UI', () => {
  it('verifies the signed-in user and shows client, callback, and requested scopes', async () => {
    await mount();
    expect(oauth.getUser).toHaveBeenCalledOnce();
    expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith('authorization-123');
    expect(container.textContent).toContain('https://client.example.test/oauth/callback');
    expect(container.textContent).toContain('openid');
    expect(container.textContent).toContain('email');
    expect(container.textContent).toContain('profile');
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(oauth.denyAuthorization).not.toHaveBeenCalled();
  });
  it('approves only after an explicit click and follows the Supabase redirect response', async () => {
    const onRedirect = await mount();
    await act(async () => buttonContaining('Approve access').click());
    expect(oauth.approveAuthorization).toHaveBeenCalledWith('authorization-123');
    await vi.waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://client.example.test/oauth/callback?code=approved'));
  });
  it('denies an application when the user explicitly chooses deny', async () => {
    const onRedirect = await mount();
    await act(async () => buttonContaining('Deny access').click());
    expect(oauth.denyAuthorization).toHaveBeenCalledWith('authorization-123');
    await vi.waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://client.example.test/oauth/callback?error=access_denied'));
  });
  it('rejects a browser-executable callback URL and does not navigate', async () => {
    oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'javascript:alert(1)' }, error: null });
    const onRedirect = await mount();
    await act(async () => buttonContaining('Approve access').click());
    expect(onRedirect).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('invalid OAuth redirect URL');
  });
  it('rejects a callback URL that differs from the registered URI shown to the user', async () => {
    oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'https://attacker.example.test/oauth/callback?code=wrong' }, error: null });
    const onRedirect = await mount();
    await act(async () => buttonContaining('Approve access').click());
    expect(onRedirect).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not match the registered callback URI');
  });
  it('rejects a callback on a different port from the registered URI', async () => {
    oauth.approveAuthorization.mockResolvedValue({
      data: { redirect_url: 'https://client.example.test:9443/oauth/callback?code=wrong-port' },
      error: null,
    });
    const onRedirect = await mount();
    await act(async () => buttonContaining('Approve access').click());
    expect(onRedirect).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not match the registered callback URI');
  });
  it('automatically follows an already-approved authorization returned by Supabase', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: 'https://client.example.test/oauth/callback?code=existing' }, error: null });
    const onRedirect = vi.fn();
    await act(async () => root.render(<OAuthConsentPage userId="user-123" onRedirect={onRedirect} />));
    await vi.waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://client.example.test/oauth/callback?code=existing'));
    expect(container.textContent).not.toContain('Approve access');
  });
  it('fails closed when the authorization identifier is missing', async () => {
    window.history.replaceState({}, '', '/oauth/consent');
    await act(async () => root.render(<OAuthConsentPage userId="user-123" onRedirect={vi.fn()} />));
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(oauth.getUser).not.toHaveBeenCalled();
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
  });
  it('refuses consent if the server identity differs from the signed-in user', async () => {
    oauth.getUser.mockResolvedValue({ data: { user: { id: 'different-user', is_anonymous: false } }, error: null });
    await act(async () => root.render(<OAuthConsentPage userId="user-123" onRedirect={vi.fn()} />));
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
  });
});
