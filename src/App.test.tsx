// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as
    | ((event: AuthChangeEvent, session: Session | null) => void)
    | null,
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('@/pages/LandingPage', () => ({
  default: () => <div>Public landing</div>,
}));
vi.mock('@/pages/Dashboard', () => ({
  default: () => <div>Private dashboard</div>,
}));
vi.mock('@/components/dashboard/RyanAICockpit', () => ({
  default: () => <div>Private cockpit</div>,
}));
vi.mock('@/pages/CommandCenter.tsx', () => ({
  default: ({ userEmail }: { userEmail: string }) => (
    <div>Private workspace {userEmail}</div>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
const session = {
  user: { id: 'alice', email: 'alice@example.com', user_metadata: {} },
} as Session;

beforeEach(() => {
  vi.resetAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.onAuthStateChange.mockImplementation((listener) => {
    auth.listener = listener;
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function expectContent(text: string) {
  await vi.waitFor(() => {
    expect(container.textContent).toContain(text);
  });
}

async function mount(hash: string) {
  window.location.hash = hash;
  await act(async () => {
    root.render(<App />);
  });
}

describe('application authentication boundary', () => {
  it.each(['dashboard', 'cockpit', 'workspace'])(
    'blocks anonymous direct access to %s',
    async (route) => {
      await mount(`/${route}`);
      await expectContent('Sign in to RYANAI');
      expect(container.textContent).not.toContain('Private');
    },
  );
  it('rejects Supabase anonymous sessions during restoration and auth events', async () => {
    const anonymousSession = {
      ...session,
      user: { ...session.user, is_anonymous: true },
    } as Session;
    auth.getSession.mockResolvedValue({
      data: { session: anonymousSession },
      error: null,
    });
    await mount('/dashboard');
    await expectContent('Sign in to RYANAI');
    expect(container.textContent).not.toContain('Private dashboard');
    await act(async () => auth.listener?.('SIGNED_IN', session));
    await expectContent('Private dashboard');
    await act(async () => auth.listener?.('SIGNED_IN', anonymousSession));
    await expectContent('Sign in to RYANAI');
    expect(container.textContent).not.toContain('Private dashboard');
  });
  it('keeps the landing page public', async () => {
    await mount('/');
    await expectContent('Public landing');
    expect(container.querySelector('a[href="#/signup"]')).not.toBeNull();
  });
  it('does not mount protected content before restoration completes', async () => {
    let restore!: (value: unknown) => void;
    auth.getSession.mockReturnValue(
      new Promise((resolve) => {
        restore = resolve;
      }),
    );
    await mount('/workspace');
    expect(container.textContent).toContain('Restoring your session');
    expect(container.textContent).not.toContain('Private workspace');
    await act(async () => restore({ data: { session }, error: null }));
    await expectContent('Private workspace alice@example.com');
  });
  it('clears protected views when the session expires and unsubscribes on unmount', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    await mount('/dashboard');
    await expectContent('Private dashboard');
    await act(async () => auth.listener?.('SIGNED_OUT', null));
    expect(container.textContent).not.toContain('Private dashboard');
    await expectContent('Sign in to RYANAI');
    await act(async () => root.unmount());
    expect(auth.unsubscribe).toHaveBeenCalledOnce();
  });
  it('ignores stale restoration after a newer sign-out event', async () => {
    let restore!: (value: unknown) => void;
    auth.getSession.mockReturnValue(
      new Promise((resolve) => {
        restore = resolve;
      }),
    );
    await mount('/workspace');
    await act(async () => auth.listener?.('SIGNED_OUT', null));
    await act(async () => restore({ data: { session }, error: null }));
    expect(container.textContent).not.toContain('Private workspace');
  });
  it('remounts all protected view state when the account changes', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    await mount('/workspace');
    const previousView = container.querySelector('main');
    const nextSession = {
      ...session,
      user: { ...session.user, id: 'bob', email: 'bob@example.com' },
    } as Session;
    await act(async () => auth.listener?.('SIGNED_IN', nextSession));
    expect(container.querySelector('main')).not.toBe(previousView);
    expect(container.textContent).not.toContain('alice@example.com');
    await expectContent('Private workspace bob@example.com');
  });
  it('performs a real sign-out and removes protected content', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    await mount('/workspace');
    await act(async () =>
      container
        .querySelector('header button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Private workspace');
  });
  it('reports sign-out failures without pretending the session was revoked', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    auth.signOut.mockResolvedValue({ error: new Error('unavailable') });
    await mount('/workspace');
    await act(async () =>
      container
        .querySelector('header button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    await expectContent('Sign out failed');
    await expectContent('Private workspace');
  });
  it('fails closed on restoration errors', async () => {
    auth.getSession.mockRejectedValue(new Error('offline'));
    await mount('/workspace');
    expect(container.textContent).toContain('Unable to restore');
    expect(container.textContent).not.toContain('Private workspace');
  });
});